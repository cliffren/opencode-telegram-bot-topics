import { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, SessionInfo } from "../../session/manager.js";
import { getCurrentProjectForScope } from "../../project/scope.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { setCurrentSessionByThread } from "../handlers/prompt.js";
import { logger } from "../../utils/logger.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { config } from "../../config.js";
import { getLocale, t } from "../../i18n/index.js";

interface SessionWithChildren {
  id: string;
  title: string;
  directory: string;
  parentID?: string;
  time: { created: number };
  children?: SessionWithChildren[];
}

const SESSION_LIST_MULTIPLIER_FOR_ROOTS = 3;
const SESSION_LIST_ABSOLUTE_MAX = 200;

function isMessageNotModifiedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("message is not modified");
}

function buildSessionTree(sessions: SessionWithChildren[]): SessionWithChildren[] {
  const sessionMap = new Map<string, SessionWithChildren>();
  const rootSessions: SessionWithChildren[] = [];

  sessions.forEach((session) => {
    sessionMap.set(session.id, { ...session, children: [] });
  });

  sessions.forEach((session) => {
    const sessionWithChildren = sessionMap.get(session.id)!;
    if (session.parentID && sessionMap.has(session.parentID)) {
      const parent = sessionMap.get(session.parentID)!;
      parent.children = parent.children || [];
      parent.children.push(sessionWithChildren);
    } else {
      rootSessions.push(sessionWithChildren);
    }
  });

  return rootSessions;
}

function buildRootSessionMenu(
  rootSessions: SessionWithChildren[],
  threadToken: string,
  localeForDate: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  rootSessions.forEach((session, index) => {
    const date = new Date(session.time.created).toLocaleDateString(localeForDate);
    const hasChildren = session.children && session.children.length > 0;
    const childIndicator = hasChildren ? "▶ " : "";
    const label = `${childIndicator}${index + 1}. ${session.title} (${date})`;

    if (hasChildren) {
      keyboard.text(label, `session:${threadToken}:h:${index}`).row();
    } else {
      keyboard.text(label, `session:${threadToken}:r:${index}`).row();
    }
  });

  return keyboard;
}

function buildSubSessionMenu(
  mainSession: SessionWithChildren,
  rootIndex: number,
  threadToken: string,
  localeForDate: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const mainDate = new Date(mainSession.time.created).toLocaleDateString(localeForDate);
  const mainLabel = `[main] ${mainSession.title} (${mainDate})`;
  keyboard.text(mainLabel, `session:${threadToken}:m:${rootIndex}`).row();

  if (mainSession.children && mainSession.children.length > 0) {
    mainSession.children.forEach((child, childIndex) => {
      const date = new Date(child.time.created).toLocaleDateString(localeForDate);
      const label = `${childIndex + 1}. ${child.title} (${date})`;
      keyboard.text(label, `session:${threadToken}:c:${rootIndex}:${childIndex}`).row();
    });
  }

  keyboard.text(t("sessions.button.back"), `session:${threadToken}:b:${rootIndex}`).row();
  return appendInlineMenuCancelButton(keyboard, "session");
}

async function loadRootSessionsForMenu(directory: string): Promise<SessionWithChildren[]> {
  const maxRootSessions = config.bot.sessionsListLimit;
  const fetchLimit = Math.min(
    Math.max(maxRootSessions * SESSION_LIST_MULTIPLIER_FOR_ROOTS, maxRootSessions),
    SESSION_LIST_ABSOLUTE_MAX,
  );

  const { data: sessions, error } = await opencodeClient.session.list({
    directory,
    limit: fetchLimit,
  });

  if (error || !sessions) {
    throw error || new Error("No data received from server");
  }

  logger.debug(
    `[Sessions] Fetched ${sessions.length} sessions (limit=${fetchLimit}) for root menu limit ${maxRootSessions}`,
  );
  sessions.forEach((session) => {
    logger.debug(`[Sessions] Session: ${session.title} | ${session.directory}`);
  });

  const rootSessions = buildSessionTree(sessions as SessionWithChildren[]);
  return rootSessions.slice(0, maxRootSessions);
}

export async function sessionsCommand(ctx: CommandContext<Context>) {
  try {
    const threadId = ctx.message?.message_thread_id ?? null;
    const currentProject = getCurrentProjectForScope(threadId, ctx.chat?.id ?? null);

    if (!currentProject) {
      await ctx.reply(t("sessions.project_not_selected"));
      return;
    }

    logger.debug(`[Sessions] Fetching sessions for directory: ${currentProject.worktree}`);

    const rootSessions = await loadRootSessionsForMenu(currentProject.worktree);

    if (rootSessions.length === 0) {
      await ctx.reply(t("sessions.empty"));
      return;
    }

    const localeForDate = getLocale() === "ru" ? "ru-RU" : "en-US";

    const currentThreadId = ctx.message?.message_thread_id ?? null;
    const threadToken = currentThreadId === null ? "none" : String(currentThreadId);

    const keyboard = buildRootSessionMenu(rootSessions, threadToken, localeForDate);

    await replyWithInlineMenu(ctx, {
      menuKind: "session",
      text: t("sessions.select"),
      keyboard,
    });
  } catch (error) {
    logger.error("[Sessions] Error fetching sessions:", error);
    await ctx.reply(t("sessions.fetch_error"));
  }
}

export async function handleSessionSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data || !callbackQuery.data.startsWith("session:")) {
    return false;
  }

  const payload = callbackQuery.data.replace("session:", "");
  const payloadParts = payload.split(":");

  let sessionId = payload;
  let callbackThreadId: number | null = null;
  let action: string | undefined;
  let childSessionId: string | undefined;
  let compactAction: "r" | "h" | "m" | "c" | "b" | null = null;
  let compactRootIndex: number | null = null;
  let compactChildIndex: number | null = null;

  const looksLikeThreadToken = payloadParts[0] === "none" || /^\d+$/.test(payloadParts[0] ?? "");

  if (looksLikeThreadToken && payloadParts.length >= 2) {
    const threadToken = payloadParts[0];
    callbackThreadId = threadToken === "none" ? null : Number.parseInt(threadToken, 10);
    if (Number.isNaN(callbackThreadId as number)) {
      callbackThreadId = null;
    }

    const maybeCompactAction = payloadParts[1];
    const maybeCompactRootIndex = payloadParts[2];
    const parsedRootIndex =
      maybeCompactRootIndex !== undefined ? Number.parseInt(maybeCompactRootIndex, 10) : Number.NaN;
    const parsedChildIndex =
      payloadParts[3] !== undefined ? Number.parseInt(payloadParts[3], 10) : Number.NaN;

    if (
      (maybeCompactAction === "r" ||
        maybeCompactAction === "h" ||
        maybeCompactAction === "m" ||
        maybeCompactAction === "b") &&
      Number.isFinite(parsedRootIndex)
    ) {
      compactAction = maybeCompactAction;
      compactRootIndex = parsedRootIndex;
    } else if (
      maybeCompactAction === "c" &&
      Number.isFinite(parsedRootIndex) &&
      Number.isFinite(parsedChildIndex)
    ) {
      compactAction = "c";
      compactRootIndex = parsedRootIndex;
      compactChildIndex = parsedChildIndex;
    } else {
      sessionId = payloadParts[1] ?? "";
      action = payloadParts[2];
      if (action === "child") {
        childSessionId = payloadParts[3];
      }
    }
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "session");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const currentProject = getCurrentProjectForScope(callbackThreadId, ctx.chat?.id ?? null);

    if (!currentProject) {
      clearAllInteractionState("session_select_project_missing");
      await ctx.answerCallbackQuery();
      await ctx.reply(t("sessions.select_project_first"));
      return true;
    }

    const threadToken = callbackThreadId === null ? "none" : String(callbackThreadId);
    const localeForDate = getLocale() === "ru" ? "ru-RU" : "en-US";

    let selectedSession: SessionWithChildren;

    if (compactAction !== null && compactRootIndex !== null) {
      const rootSessions = await loadRootSessionsForMenu(currentProject.worktree);

      if (compactAction === "b") {
        const rootMenuKeyboard = buildRootSessionMenu(rootSessions, threadToken, localeForDate);
        try {
          await ctx.editMessageText(t("sessions.select"), {
            reply_markup: appendInlineMenuCancelButton(rootMenuKeyboard, "session"),
          });
        } catch (error) {
          if (!isMessageNotModifiedError(error)) {
            throw error;
          }
          await ctx.answerCallbackQuery();
        }
        return true;
      }

      const mainSession = rootSessions[compactRootIndex];

      if (!mainSession) {
        throw new Error(`Invalid root session index: ${compactRootIndex}`);
      }

      if (compactAction === "h") {
        const subMenuKeyboard = buildSubSessionMenu(
          mainSession,
          compactRootIndex,
          threadToken,
          localeForDate,
        );
        try {
          await ctx.editMessageText(t("sessions.select_sub"), {
            reply_markup: subMenuKeyboard,
          });
        } catch (error) {
          if (!isMessageNotModifiedError(error)) {
            throw error;
          }
          await ctx.answerCallbackQuery();
        }
        return true;
      }

      if (compactAction === "c") {
        if (compactChildIndex === null) {
          throw new Error("Child index is missing for compact child callback");
        }

        const childSession = mainSession.children?.[compactChildIndex];
        if (!childSession) {
          throw new Error(
            `Invalid child session index: root=${compactRootIndex}, child=${compactChildIndex}`,
          );
        }
        selectedSession = childSession;
      } else {
        selectedSession = mainSession;
      }
    } else {
      const { data: session, error } = await opencodeClient.session.get({
        sessionID: sessionId,
        directory: currentProject.worktree,
      });

      if (error || !session) {
        throw error || new Error("Failed to get session details");
      }

      selectedSession = {
        id: session.id,
        title: session.title,
        directory: session.directory,
        parentID: session.parentID,
        time: session.time,
      };
    }

    if (action === "children") {
      const mainSessionWithChildren: SessionWithChildren = {
        id: selectedSession.id,
        title: selectedSession.title,
        directory: selectedSession.directory,
        parentID: selectedSession.parentID,
        time: selectedSession.time,
        children: [],
      };
      let mainSessionIndex = 0;

      const rootSessions = await loadRootSessionsForMenu(currentProject.worktree);
      const foundIndex = rootSessions.findIndex((s) => s.id === selectedSession.id);
      if (foundIndex >= 0) {
        mainSessionIndex = foundIndex;
        mainSessionWithChildren.children = rootSessions[foundIndex]?.children;
      }

      const subMenuKeyboard = buildSubSessionMenu(
        mainSessionWithChildren,
        mainSessionIndex,
        threadToken,
        localeForDate,
      );
      try {
        await ctx.editMessageText(t("sessions.select_sub"), {
          reply_markup: subMenuKeyboard,
        });
      } catch (error) {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
        await ctx.answerCallbackQuery();
      }
      return true;
    }

    if (action === "main") {
      childSessionId = selectedSession.id;
    }

    if (action === "child" && childSessionId) {
      const { data: childSession, error: childError } = await opencodeClient.session.get({
        sessionID: childSessionId,
        directory: currentProject.worktree,
      });

      if (childError || !childSession) {
        throw childError || new Error("Failed to get child session details");
      }

      selectedSession = {
        id: childSession.id,
        title: childSession.title,
        directory: childSession.directory,
        parentID: childSession.parentID,
        time: childSession.time,
      };
    }

    if (
      !childSessionId &&
      action !== "children" &&
      compactAction !== "m" &&
      compactAction !== "c"
    ) {
      const rootSessions = await loadRootSessionsForMenu(currentProject.worktree);
      const mainSession = rootSessions.find((s) => s.id === selectedSession.id);
      if (mainSession && mainSession.children && mainSession.children.length > 0) {
        const mainSessionIndex = rootSessions.findIndex((s) => s.id === selectedSession.id);
        const subMenuKeyboard = buildSubSessionMenu(
          mainSession,
          mainSessionIndex >= 0 ? mainSessionIndex : 0,
          threadToken,
          localeForDate,
        );
        try {
          await ctx.editMessageText(t("sessions.select_sub"), {
            reply_markup: subMenuKeyboard,
          });
        } catch (error) {
          if (!isMessageNotModifiedError(error)) {
            throw error;
          }
          await ctx.answerCallbackQuery();
        }
        return true;
      }
    }

    logger.info(
      `[Bot] Session selected: id=${selectedSession.id}, title="${selectedSession.title}", project=${currentProject.worktree}`,
    );

    const sessionInfo: SessionInfo = {
      id: selectedSession.id,
      title: selectedSession.title,
      directory: currentProject.worktree,
    };
    setCurrentSession(sessionInfo);

    const threadId = callbackThreadId ?? ctx.callbackQuery?.message?.message_thread_id ?? null;
    logger.info(`[Sessions] Binding selected session to threadId=${threadId ?? "none"}`);
    setCurrentSessionByThread(threadId, ctx.chat?.id ?? null);

    summaryAggregator.clear();
    clearAllInteractionState("session_switched");

    await ctx.answerCallbackQuery();

    let loadingMessageId: number | null = null;
    if (ctx.chat) {
      try {
        const loadingMessage = await ctx.api.sendMessage(
          ctx.chat.id,
          t("sessions.loading_context"),
          { message_thread_id: threadId ?? undefined },
        );
        loadingMessageId = loadingMessage.message_id;
      } catch (err) {
        logger.error("[Sessions] Failed to send loading message:", err);
      }
    }

    // Initialize pinned message manager for this chat
    if (
      ctx.chat &&
      (!pinnedMessageManager.isInitialized() ||
        pinnedMessageManager.getState().chatId !== ctx.chat.id ||
        pinnedMessageManager.getState().threadId !== threadId)
    ) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id, threadId);
    }

    // Initialize keyboard manager if not already
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    try {
      // Create new pinned message for this session
      await pinnedMessageManager.onSessionChange(
        selectedSession.id,
        selectedSession.title,
        currentProject.worktree,
      );
      // Load context from session history (for existing sessions)
      // Wait for it to complete so keyboard has correct context
      await pinnedMessageManager.loadContextFromHistory(
        selectedSession.id,
        currentProject.worktree,
      );
    } catch (err) {
      logger.error("[Bot] Error initializing pinned message:", err);
    }

    if (ctx.chat) {
      const chatId = ctx.chat.id;

      // Update keyboard with loaded context (callback executes async via setImmediate, so update manually)
      const contextInfo = pinnedMessageManager.getContextInfo();
      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
      }

      // Delete loading message
      if (loadingMessageId) {
        try {
          await ctx.api.deleteMessage(chatId, loadingMessageId);
        } catch (err) {
          logger.debug("[Sessions] Failed to delete loading message:", err);
        }
      }

      // Send session selection confirmation with updated keyboard
      const keyboard = keyboardManager.getKeyboard();
      try {
        await ctx.api.sendMessage(
          chatId,
          t("sessions.selected", { title: selectedSession.title }),
          {
            reply_markup: keyboard,
            message_thread_id: threadId ?? undefined,
          },
        );
      } catch (err) {
        logger.error("[Sessions] Failed to send selection message:", err);
      }

      // Send preview asynchronously
      safeBackgroundTask({
        taskName: "sessions.sendPreview",
        task: () =>
          sendSessionPreview(
            ctx.api,
            chatId,
            null,
            selectedSession.title,
            selectedSession.id,
            currentProject.worktree,
            threadId,
          ),
      });
    }

    await ctx.deleteMessage();
  } catch (error) {
    clearAllInteractionState("session_select_error");
    logger.error("[Sessions] Error selecting session:", error);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("sessions.select_error"));
  }

  return true;
}

type SessionPreviewItem = {
  role: "user" | "assistant";
  text: string;
  created: number;
};

const PREVIEW_MESSAGES_LIMIT = 6;
const PREVIEW_ITEM_MAX_LENGTH = 420;
const TELEGRAM_MESSAGE_LIMIT = 4096;

function extractTextParts(parts: Array<{ type: string; text?: string }>): string | null {
  const textParts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);

  if (textParts.length === 0) {
    return null;
  }

  const text = textParts.join("").trim();
  return text.length > 0 ? text : null;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const clipped = text.slice(0, Math.max(0, maxLength - 3)).trimEnd();
  return `${clipped}...`;
}

async function loadSessionPreview(
  sessionId: string,
  directory: string,
): Promise<SessionPreviewItem[]> {
  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
      limit: PREVIEW_MESSAGES_LIMIT,
    });

    if (error || !messages) {
      logger.warn("[Sessions] Failed to fetch session messages:", error);
      return [];
    }

    const items = messages
      .map(({ info, parts }) => {
        const role = info.role as "user" | "assistant" | undefined;
        if (role !== "user" && role !== "assistant") {
          return null;
        }

        if (role === "assistant" && (info as { summary?: boolean }).summary) {
          return null;
        }

        const text = extractTextParts(parts as Array<{ type: string; text?: string }>);
        if (!text) {
          return null;
        }

        const created = info.time?.created ?? 0;
        return {
          role,
          text: truncateText(text, PREVIEW_ITEM_MAX_LENGTH),
          created,
        } as SessionPreviewItem;
      })
      .filter((item): item is SessionPreviewItem => Boolean(item));

    return items.sort((a, b) => a.created - b.created);
  } catch (err) {
    logger.error("[Sessions] Error loading session preview:", err);
    return [];
  }
}

function formatSessionPreview(_sessionTitle: string, items: SessionPreviewItem[]): string {
  const lines: string[] = [];

  if (items.length === 0) {
    lines.push(t("sessions.preview.empty"));
    return lines.join("\n");
  }

  lines.push(t("sessions.preview.title"));

  items.forEach((item, index) => {
    const label = item.role === "user" ? t("sessions.preview.you") : t("sessions.preview.agent");
    lines.push(`${label} ${item.text}`);
    if (index < items.length - 1) {
      lines.push("");
    }
  });

  const rawMessage = lines.join("\n");
  return truncateText(rawMessage, TELEGRAM_MESSAGE_LIMIT);
}

async function sendSessionPreview(
  api: Context["api"],
  chatId: number,
  messageId: number | null,
  sessionTitle: string,
  sessionId: string,
  directory: string,
  messageThreadId: number | null,
): Promise<void> {
  const previewItems = await loadSessionPreview(sessionId, directory);
  const finalText = formatSessionPreview(sessionTitle, previewItems);

  if (messageId) {
    try {
      await api.editMessageText(chatId, messageId, finalText);
      return;
    } catch (err) {
      logger.warn("[Sessions] Failed to edit preview message, sending new one:", err);
    }
  }

  try {
    await api.sendMessage(chatId, finalText, { message_thread_id: messageThreadId ?? undefined });
  } catch (err) {
    logger.error("[Sessions] Failed to send session preview message:", err);
  }
}
