import { Bot, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { clearSession, getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { ingestSessionInfoForCache } from "../../session/cache-manager.js";
import {
  clearScopedSession,
  getCurrentProject,
  getScopedSession,
  setScopedSession,
} from "../../settings/manager.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { stopEventListening } from "../../opencode/events.js";
import { interactionManager } from "../../interaction/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

/** Module-level references for async callbacks that don't have ctx. */
let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
let threadIdInstance: number | null = null;

/** Chat/thread scoped session mapping for Topic + private isolation */
const scopedSessionMap = new Map<string, { id: string; title: string; directory: string }>();

function getSessionScopeKey(chatId: number | null, threadId: number | null): string {
  return `${chatId ?? "none"}:${threadId ?? "private"}`;
}

function getThreadId(ctx: Context): number | null {
  return ctx.message?.message_thread_id ?? null;
}

export function setCurrentSessionByThread(threadId: number | null, chatId: number | null): void {
  const currentSession = getCurrentSession();
  if (!currentSession) {
    return;
  }

  const scopeKey = getSessionScopeKey(chatId, threadId);
  scopedSessionMap.set(scopeKey, currentSession);
  setScopedSession(scopeKey, currentSession);
}

export function getCurrentSessionByThread(threadId: number | null, chatId: number | null): { id: string; title: string; directory: string } | null {
  const scopeKey = getSessionScopeKey(chatId, threadId);
  const inMemory = scopedSessionMap.get(scopeKey);
  if (inMemory) {
    return inMemory;
  }

  const persisted = getScopedSession(scopeKey);
  if (!persisted) {
    return null;
  }

  scopedSessionMap.set(scopeKey, persisted);
  return persisted;
}

export function clearSessionByThread(threadId: number | null, chatId: number | null): void {
  const scopeKey = getSessionScopeKey(chatId, threadId);
  scopedSessionMap.delete(scopeKey);
  clearScopedSession(scopeKey);
}

export function getPromptBotInstance(): Bot<Context> | null {
  return botInstance;
}

export function getPromptChatId(): number | null {
  return chatIdInstance;
}

export function getPromptThreadId(): number | null {
  return threadIdInstance;
}

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });

    if (error || !data) {
      logger.warn("[Bot] Failed to check session status before prompt:", error);
      return false;
    }

    const sessionStatus = (data as Record<string, { type?: string }>)[sessionId];
    if (!sessionStatus) {
      return false;
    }

    logger.debug(`[Bot] Current session status before prompt: ${sessionStatus.type || "unknown"}`);
    return sessionStatus.type === "busy";
  } catch (err) {
    logger.warn("[Bot] Error checking session status before prompt:", err);
    return false;
  }
}

async function isSessionKnown(sessionId: string, directory: string): Promise<boolean | null> {
  try {
    const { data, error } = await opencodeClient.session.get({
      sessionID: sessionId,
      directory,
    });

    if (error) {
      const errorText =
        error instanceof Error
          ? error.message
          : (() => {
              try {
                return JSON.stringify(error);
              } catch {
                return String(error);
              }
            })();

      if (/not found|404/i.test(errorText)) {
        return false;
      }

      logger.warn("[Bot] Failed to verify session existence:", error);
      return null;
    }

    if (!data) {
      return null;
    }

    return true;
  } catch (err) {
    logger.warn("[Bot] Error verifying session existence:", err);
    return null;
  }
}

async function resetMismatchedSessionContext(threadId: number | null, chatId: number | null): Promise<void> {
  stopEventListening();
  summaryAggregator.clear();
  clearAllInteractionState("session_mismatch_reset");
  clearSession();
  
  // Clear thread session for Topic isolation
  clearSessionByThread(threadId, chatId);
  
  keyboardManager.clearContext();

  if (!pinnedMessageManager.isInitialized()) {
    return;
  }

  try {
    await pinnedMessageManager.clear();
  } catch (err) {
    logger.error("[Bot] Failed to clear pinned message during session reset:", err);
  }
}

export interface ProcessPromptDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string) => Promise<void>;
}

export type PromptFilePartInput = {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
};

type PromptPartInput = { type: "text"; text: string } | PromptFilePartInput;

/**
 * Processes a user prompt: ensures project/session, subscribes to events, and sends
 * the prompt to OpenCode. Used by both text and voice message handlers.
 *
 * @returns true if the prompt was dispatched, false if it was blocked/failed early.
 */
export async function processUserPrompt(
  ctx: Context,
  text: string,
  deps: ProcessPromptDeps,
  extraParts: PromptFilePartInput[] = [],
): Promise<boolean> {
  const { bot, ensureEventSubscription } = deps;

  const currentProject = getCurrentProject();
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return false;
  }

  botInstance = bot;
  chatIdInstance = ctx.chat!.id;
  threadIdInstance = getThreadId(ctx);

  // For Topic isolation, get session by threadId
  const currentThreadId = getThreadId(ctx);
  let currentSession = getCurrentSessionByThread(currentThreadId, ctx.chat?.id ?? null);
  logger.info(
    `[Prompt] Thread routing: threadId=${currentThreadId ?? "none"}, session=${currentSession?.id ?? "none"}`,
  );

  // Check project/session directory match
  if (currentSession && currentSession.directory !== currentProject.worktree) {
    logger.warn(
      `[Bot] Session/project mismatch detected. sessionDirectory=${currentSession.directory}, projectDirectory=${currentProject.worktree}. Resetting session context.`,
    );
    await resetMismatchedSessionContext(currentThreadId, ctx.chat?.id ?? null);
    await ctx.reply(t("bot.session_reset_project_mismatch"));
    return false;
  }

  if (currentSession) {
    const sessionKnown = await isSessionKnown(currentSession.id, currentSession.directory);
    if (sessionKnown === false) {
      logger.warn(
        `[Bot] Mapped session not found on server, will create new session. sessionId=${currentSession.id}, chatId=${ctx.chat?.id ?? "none"}, threadId=${currentThreadId ?? "none"}`,
      );
      clearSessionByThread(currentThreadId, ctx.chat?.id ?? null);
      currentSession = null;
    }
  }

  if (!currentSession) {
    await ctx.reply(t("bot.creating_session"));

    const sessionCreateOptions: { directory: string; title?: string } = {
      directory: currentProject.worktree,
    };
    
    // Add Topic ID to session title for isolation
    if (currentThreadId) {
      sessionCreateOptions.title = `Topic ${currentThreadId}`;
    }

    const { data: session, error } = await opencodeClient.session.create(sessionCreateOptions);

    if (error || !session) {
      await ctx.reply(t("bot.create_session_error"));
      return false;
    }

    logger.info(
      `[Bot] Created new session: id=${session.id}, title="${session.title}", project=${currentProject.worktree}`,
    );

    currentSession = {
      id: session.id,
      title: session.title,
      directory: currentProject.worktree,
    };

    setCurrentSession(currentSession);
    
    // Store session for Topic/private isolation and persist mapping
    setCurrentSessionByThread(currentThreadId, ctx.chat?.id ?? null);
    
    await ingestSessionInfoForCache(session);

    // Create pinned message for new session
    try {
      if (!pinnedMessageManager.isInitialized() || pinnedMessageManager.getState().chatId !== ctx.chat!.id) {
        pinnedMessageManager.initialize(ctx.api, ctx.chat!.id);
      }
      await pinnedMessageManager.onSessionChange(session.id, session.title);
    } catch (err) {
      logger.error("[Bot] Error creating pinned message for new session:", err);
    }

    const currentAgent = getStoredAgent(currentThreadId, ctx.chat?.id ?? null);
    const currentModel = getStoredModel(currentThreadId, ctx.chat?.id ?? null);
    const contextInfo = pinnedMessageManager.getContextInfo();
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const keyboard = createMainKeyboard(
      currentAgent,
      currentModel,
      contextInfo ?? undefined,
      variantName,
    );

    await ctx.reply(t("bot.session_created", { title: session.title }), {
      reply_markup: keyboard,
    });
  } else {
    logger.info(
      `[Bot] Using existing session: id=${currentSession.id}, title="${currentSession.title}"`,
    );

    // Ensure pinned message exists for existing session
    if (!pinnedMessageManager.getState().messageId || pinnedMessageManager.getState().chatId !== ctx.chat!.id) {
      try {
        if (!pinnedMessageManager.isInitialized() || pinnedMessageManager.getState().chatId !== ctx.chat!.id) {
          pinnedMessageManager.initialize(ctx.api, ctx.chat!.id);
        }
        await pinnedMessageManager.onSessionChange(currentSession.id, currentSession.title);
      } catch (err) {
        logger.error("[Bot] Error creating pinned message for existing session:", err);
      }
    }
  }

  // Keep global session state in sync with current thread session.
  // Several downstream callbacks still rely on getCurrentSession().
  setCurrentSession(currentSession);

  await ensureEventSubscription(currentSession.directory);

  summaryAggregator.setSession(currentSession.id);
  summaryAggregator.setBotAndChatId(bot, ctx.chat!.id);

  const sessionIsBusy = await isSessionBusy(currentSession.id, currentSession.directory);
  if (sessionIsBusy) {
    logger.info(`[Bot] Ignoring new prompt: session ${currentSession.id} is busy`);
    await ctx.reply(t("bot.session_busy"));
    return false;
  }

  try {
    const currentAgent = getStoredAgent(currentThreadId, ctx.chat?.id ?? null);
    const storedModel = getStoredModel(currentThreadId, ctx.chat?.id ?? null);

    const promptOptions: {
      sessionID: string;
      directory: string;
      parts: PromptPartInput[];
      model?: { providerID: string; modelID: string };
      agent?: string;
      variant?: string;
    } = {
      sessionID: currentSession.id,
      directory: currentSession.directory,
      parts: [{ type: "text", text }, ...extraParts],
      agent: currentAgent,
    };

    // Use stored model (from settings or config)
    if (storedModel.providerID && storedModel.modelID) {
      promptOptions.model = {
        providerID: storedModel.providerID,
        modelID: storedModel.modelID,
      };

      // Add variant if specified
      if (storedModel.variant) {
        promptOptions.variant = storedModel.variant;
      }
    }

    const promptErrorLogContext = {
      sessionId: currentSession.id,
      directory: currentSession.directory,
      agent: currentAgent || "default",
      modelProvider: storedModel.providerID || "default",
      modelId: storedModel.modelID || "default",
      variant: storedModel.variant || "default",
      promptLength: text.length,
    };

    logger.info(`[Bot] Calling session.prompt (fire-and-forget) with agent=${currentAgent}...`);

    // CRITICAL: DO NOT wait for session.prompt to complete.
    // If we wait, the handler will not finish and grammY will not call getUpdates,
    // which blocks receiving button callback_query updates.
    // The processing result will arrive via SSE events.
    safeBackgroundTask({
      taskName: "session.prompt",
      task: () => opencodeClient.session.prompt(promptOptions),
      onSuccess: ({ error }) => {
        if (error) {
          const details = formatErrorDetails(error, 6000);
          logger.error(
            "[Bot] OpenCode API returned an error for session.prompt",
            promptErrorLogContext,
          );
          logger.error("[Bot] session.prompt error details:", details);
          logger.error("[Bot] session.prompt raw API error object:", error);

          // Send user-friendly error via API directly because ctx is no longer available
          void bot.api.sendMessage(ctx.chat!.id, t("bot.prompt_send_error")).catch(() => {});
          return;
        }

        logger.info("[Bot] session.prompt completed");
      },
      onError: (error) => {
        const details = formatErrorDetails(error, 6000);
        logger.error("[Bot] session.prompt background task failed", promptErrorLogContext);
        logger.error("[Bot] session.prompt background failure details:", details);
        logger.error("[Bot] session.prompt raw background error object:", error);
        void bot.api.sendMessage(ctx.chat!.id, t("bot.prompt_send_error")).catch(() => {});
      },
    });

    return true;
  } catch (err) {
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot()) {
      clearAllInteractionState("message_handler_error");
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}
