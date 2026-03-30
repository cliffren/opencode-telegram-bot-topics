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
import { getCurrentProjectForScope } from "../../project/scope.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { stopEventListening } from "../../opencode/events.js";
import { config } from "../../config.js";
import { interactionManager } from "../../interaction/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { getInteractionScopeKeyFromContext } from "../../interaction/scope.js";
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

interface PendingSendFileIntent {
  createdAt: number;
  sourceText: string;
}

const pendingSendFileIntentByScope = new Map<string, PendingSendFileIntent>();
const PENDING_SEND_FILE_TTL_MS = 3 * 60 * 1000;

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

export function getCurrentSessionByThread(
  threadId: number | null,
  chatId: number | null,
): { id: string; title: string; directory: string } | null {
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

async function resetMismatchedSessionContext(
  threadId: number | null,
  chatId: number | null,
): Promise<void> {
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

function isSendFileIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  const zhFileTerms =
    "文件|文档|图片|照片|截图|图|pdf|ppt|pptx|slides|幻灯片|excel|表格|word|txt|文本";
  return (
    /(send|share|deliver).*(file|document|image|photo|screenshot|pic|pdf|ppt|pptx|slides|excel|spreadsheet|table|word|txt|artifacts?).*(telegram|chat|me)/i.test(
      normalized,
    ) ||
    /(file|document|image|photo|screenshot|pic|pdf|ppt|pptx|slides|excel|spreadsheet|table|word|txt|artifacts?).*(send|share|deliver).*(telegram|chat|me)/i.test(
      normalized,
    ) ||
    /(send|share|deliver).*(telegram|chat|me).*(file|document|image|photo|screenshot|pic|pdf|ppt|pptx|slides|excel|spreadsheet|table|word|txt|artifacts?)/i.test(
      normalized,
    ) ||
    /(send|share|deliver)\s+(me\s+)?(the\s+)?(files?|documents?|images?|photos?|screenshots?|pics?|pdf|pptx?|slides?|excel|spreadsheets?|tables?|word|txt|artifacts?)(\s+files?)?/i.test(
      normalized,
    ) ||
    new RegExp(`(发送|发|传).*(${zhFileTerms}).*(给我|到telegram|到群|到聊天)`).test(text) ||
    new RegExp(`(把|将).*(${zhFileTerms}).*(发送|发|传).*(给我|到telegram|到群|到聊天)`).test(
      text,
    ) ||
    new RegExp(`(发给我|传给我).*(${zhFileTerms}|artifact|artifacts)`, "i").test(text) ||
    new RegExp(`(${zhFileTerms}|artifact|artifacts).*(发给我|传给我)`, "i").test(text) ||
    /(отправь|скинь|пришли|передай).*(файл|документ|картинк|изображени|скриншот).*(мне|в\s*telegram|в\s*чат)/i.test(
      normalized,
    ) ||
    /(отправь|скинь|пришли|передай).*(мне|в\s*telegram|в\s*чат).*(файл|документ|картинк|изображени|скриншот|pdf|ppt|pptx|slides|excel|таблиц|word|txt)/i.test(
      normalized,
    ) ||
    /(файл|документ|картинк|изображени|скриншот).*(отправь|скинь|пришли|передай).*(мне|в\s*telegram|в\s*чат)/i.test(
      normalized,
    ) ||
    /(пришли|отправь|скинь)\s+мне\s+(файлы?|документы?|картинки|изображения|скриншоты|слайды|таблицы|pdf|pptx?|excel|word|txt)/i.test(
      normalized,
    ) ||
    /(артефакт|артефакты|artifacts?).*(отправь|скинь|пришли).*(мне|в\s*чат|в\s*telegram)/i.test(
      normalized,
    )
  );
}

function isSendFileConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /^(发吧|发送吧|发过去|传吧|就发这个|发一下|发下|现在发|可以发了|执行吧|继续)$/i.test(
      text.trim(),
    ) ||
    /^(send it|send now|go ahead|do it|proceed|execute)$/i.test(normalized) ||
    /^(отправь|скинь|давай|выполняй|выполни|продолжай|ок\b|поехали)$/i.test(normalized)
  );
}

function getFreshPendingSendFileIntent(scopeKey: string): PendingSendFileIntent | null {
  const pending = pendingSendFileIntentByScope.get(scopeKey);
  if (!pending) {
    return null;
  }

  if (Date.now() - pending.createdAt > PENDING_SEND_FILE_TTL_MS) {
    pendingSendFileIntentByScope.delete(scopeKey);
    return null;
  }

  return pending;
}

function getSendFileInstructionByPlatform(): string {
  const primaryCommand = config.external.sendFileCliCommand;
  const fallbackCommand = "opencode-telegram-sendfile";
  const configuredBinDir = config.external.sendFileCliBinDir?.trim();
  const runtimeMode = process.env.OPENCODE_TELEGRAM_RUNTIME_MODE?.trim();
  const runtimeHome = process.env.OPENCODE_TELEGRAM_HOME?.trim();

  if (process.platform === "win32") {
    const pathPatchCommand = configuredBinDir
      ? `$env:Path = \"${configuredBinDir};$env:Path\"`
      : '$env:Path = "$env:APPDATA\\npm;$env:Path"';
    const runtimePatchParts: string[] = [];
    if (runtimeMode) {
      runtimePatchParts.push(`$env:OPENCODE_TELEGRAM_RUNTIME_MODE = \"${runtimeMode}\"`);
    }
    if (runtimeHome) {
      runtimePatchParts.push(`$env:OPENCODE_TELEGRAM_HOME = \"${runtimeHome}\"`);
    }
    const runtimePatchCommand = runtimePatchParts.join("; ");
    const fullRunCommand = [runtimePatchCommand, pathPatchCommand, `${primaryCommand} <file-path>`]
      .filter((part) => part.length > 0)
      .join("; ");

    return [
      "When user asks to send a file to Telegram, execute CLI (do not explain /sendfile).",
      `Run: ${fullRunCommand}`,
      `Fallback: ${fallbackCommand} <file-path>`,
      "After execution, reply with a minimal confirmation.",
      "If still unavailable, report exact command/path error.",
    ].join("\n");
  }

  const pathPatchCommand = configuredBinDir
    ? `export PATH=\"${configuredBinDir}:$PATH\"`
    : 'export PATH="$HOME/.npm-global/bin:$PATH"';
  const runtimePatchParts: string[] = [];
  if (runtimeMode) {
    runtimePatchParts.push(`export OPENCODE_TELEGRAM_RUNTIME_MODE=\"${runtimeMode}\"`);
  }
  if (runtimeHome) {
    runtimePatchParts.push(`export OPENCODE_TELEGRAM_HOME=\"${runtimeHome}\"`);
  }
  const runtimePatchCommand = runtimePatchParts.join(" && ");
  const fullRunCommand = [runtimePatchCommand, pathPatchCommand, `${primaryCommand} <file-path>`]
    .filter((part) => part.length > 0)
    .join(" && ");

  return [
    "When user asks to send a file to Telegram, execute CLI (do not explain /sendfile).",
    `Run: ${fullRunCommand}`,
    `Fallback: ${fallbackCommand} <file-path>`,
    "After execution, reply with a minimal confirmation.",
    "If still unavailable, report exact command/path error.",
  ].join("\n");
}

function maybeAugmentPromptForSendFileIntent(
  text: string,
  scopeKey: string,
): { promptText: string; injected: boolean } {
  if (!config.bot.autoSendFiles) {
    return { promptText: text, injected: false };
  }

  const directIntent = isSendFileIntent(text);
  if (directIntent) {
    pendingSendFileIntentByScope.set(scopeKey, {
      createdAt: Date.now(),
      sourceText: text,
    });
  }

  const pendingIntent = getFreshPendingSendFileIntent(scopeKey);
  const confirmationIntent = isSendFileConfirmation(text) && pendingIntent !== null;

  if (!directIntent && !confirmationIntent) {
    return { promptText: text, injected: false };
  }

  const effectiveUserRequest =
    confirmationIntent && pendingIntent ? pendingIntent.sourceText : text;
  if (confirmationIntent) {
    pendingSendFileIntentByScope.delete(scopeKey);
  }

  const instruction = getSendFileInstructionByPlatform();
  return {
    promptText: `${instruction}\n\nUser request:\n${effectiveUserRequest}`,
    injected: true,
  };
}

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

  const currentThreadId = getThreadId(ctx);
  const currentProject = getCurrentProjectForScope(currentThreadId, ctx.chat?.id ?? null);
  if (!currentProject) {
    await ctx.reply(t("bot.project_not_selected"));
    return false;
  }

  botInstance = bot;
  chatIdInstance = ctx.chat!.id;
  threadIdInstance = getThreadId(ctx);

  // For Topic isolation, get session by threadId
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
      if (
        !pinnedMessageManager.isInitialized() ||
        pinnedMessageManager.getState().chatId !== ctx.chat!.id ||
        pinnedMessageManager.getState().threadId !== currentThreadId
      ) {
        pinnedMessageManager.initialize(ctx.api, ctx.chat!.id, currentThreadId);
      }
      await pinnedMessageManager.onSessionChange(
        session.id,
        session.title,
        currentProject.worktree,
      );
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
    if (
      !pinnedMessageManager.getState().messageId ||
      pinnedMessageManager.getState().chatId !== ctx.chat!.id ||
      pinnedMessageManager.getState().threadId !== currentThreadId
    ) {
      try {
        if (
          !pinnedMessageManager.isInitialized() ||
          pinnedMessageManager.getState().chatId !== ctx.chat!.id ||
          pinnedMessageManager.getState().threadId !== currentThreadId
        ) {
          pinnedMessageManager.initialize(ctx.api, ctx.chat!.id, currentThreadId);
        }
        await pinnedMessageManager.onSessionChange(
          currentSession.id,
          currentSession.title,
          currentProject.worktree,
        );
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

    const scopeKey = getSessionScopeKey(ctx.chat?.id ?? null, currentThreadId);
    const sendFileAugmentation = maybeAugmentPromptForSendFileIntent(text, scopeKey);
    const promptText = sendFileAugmentation.promptText;

    if (sendFileAugmentation.injected) {
      logger.info("[Prompt] Injected sendfile CLI guidance for model prompt");
    }

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
      parts: [{ type: "text", text: promptText }, ...extraParts],
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
          void bot.api
            .sendMessage(ctx.chat!.id, t("bot.prompt_send_error"), {
              message_thread_id: currentThreadId ?? undefined,
            })
            .catch(() => {});
          return;
        }

        logger.info("[Bot] session.prompt completed");
      },
      onError: (error) => {
        const details = formatErrorDetails(error, 6000);
        logger.error("[Bot] session.prompt background task failed", promptErrorLogContext);
        logger.error("[Bot] session.prompt background failure details:", details);
        logger.error("[Bot] session.prompt raw background error object:", error);
        void bot.api
          .sendMessage(ctx.chat!.id, t("bot.prompt_send_error"), {
            message_thread_id: currentThreadId ?? undefined,
          })
          .catch(() => {});
      },
    });

    return true;
  } catch (err) {
    logger.error("Error in prompt handler:", err);
    if (interactionManager.getSnapshot(getInteractionScopeKeyFromContext(ctx))) {
      clearAllInteractionState("message_handler_error");
    }
    await ctx.reply(t("error.generic"));
    return false;
  }
}
