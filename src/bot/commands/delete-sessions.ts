import { CommandContext, Context, InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { clearSession, getCurrentSession } from "../../session/manager.js";
import { getCurrentProjectForScope } from "../../project/scope.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { clearSessionByThread, getCurrentSessionByThread } from "../handlers/prompt.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import { logger } from "../../utils/logger.js";
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

  const rootSessions = buildSessionTree(sessions as SessionWithChildren[]);
  return rootSessions.slice(0, maxRootSessions);
}

function buildRootDeleteMenu(
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
      keyboard.text(label, `delete_session:${threadToken}:h:${index}`).row();
    } else {
      keyboard.text(label, `delete_session:${threadToken}:r:${index}`).row();
    }
  });

  return keyboard;
}

function buildSubDeleteMenu(
  mainSession: SessionWithChildren,
  rootIndex: number,
  threadToken: string,
  localeForDate: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const mainDate = new Date(mainSession.time.created).toLocaleDateString(localeForDate);
  const mainLabel = `[main] ${mainSession.title} (${mainDate})`;
  keyboard.text(mainLabel, `delete_session:${threadToken}:m:${rootIndex}`).row();

  if (mainSession.children && mainSession.children.length > 0) {
    mainSession.children.forEach((child, childIndex) => {
      const date = new Date(child.time.created).toLocaleDateString(localeForDate);
      const label = `${childIndex + 1}. ${child.title} (${date})`;
      keyboard.text(label, `delete_session:${threadToken}:c:${rootIndex}:${childIndex}`).row();
    });
  }

  keyboard.text(t("sessions.button.back"), `delete_session:${threadToken}:l`).row();
  return appendInlineMenuCancelButton(keyboard, "delete_session");
}

function buildDeleteConfirmMenu(threadToken: string, sessionId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard
    .text(t("delete_sessions.button.confirm"), `delete_session:${threadToken}:x:${sessionId}`)
    .row();
  return appendInlineMenuCancelButton(keyboard, "delete_session");
}

function getCascadeDeleteIds(
  rootSessions: SessionWithChildren[],
  targetSessionId: string,
): string[] {
  const matchedRoot = rootSessions.find(
    (root) =>
      root.id === targetSessionId ||
      Boolean(root.children?.some((child) => child.id === targetSessionId)),
  );

  if (!matchedRoot) {
    return [targetSessionId];
  }

  if (matchedRoot.id !== targetSessionId) {
    return [targetSessionId];
  }

  const childIds = (matchedRoot.children ?? []).map((child) => child.id);
  return [...childIds, matchedRoot.id];
}

function getThreadTokenFromContext(ctx: CommandContext<Context>): string {
  const currentThreadId = ctx.message?.message_thread_id ?? null;
  return currentThreadId === null ? "none" : String(currentThreadId);
}

export async function deleteSessionsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const currentThreadId = ctx.message?.message_thread_id ?? null;
    const currentProject = getCurrentProjectForScope(currentThreadId, ctx.chat?.id ?? null);

    if (!currentProject) {
      await ctx.reply(t("delete_sessions.project_not_selected"));
      return;
    }

    const rootSessions = await loadRootSessionsForMenu(currentProject.worktree);
    if (rootSessions.length === 0) {
      await ctx.reply(t("delete_sessions.empty"));
      return;
    }

    const localeForDate = getLocale() === "ru" ? "ru-RU" : "en-US";
    const threadToken = getThreadTokenFromContext(ctx);
    const keyboard = buildRootDeleteMenu(rootSessions, threadToken, localeForDate);

    await replyWithInlineMenu(ctx, {
      menuKind: "delete_session",
      text: t("delete_sessions.select"),
      keyboard,
    });
  } catch (error) {
    logger.error("[DeleteSessions] Error opening delete sessions menu:", error);
    await ctx.reply(t("delete_sessions.fetch_error"));
  }
}

export async function handleDeleteSessionSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery?.data || !callbackQuery.data.startsWith("delete_session:")) {
    return false;
  }

  const payload = callbackQuery.data.replace("delete_session:", "");
  const payloadParts = payload.split(":");
  if (payloadParts.length < 2) {
    await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    return true;
  }

  const threadToken = payloadParts[0] ?? "none";
  const callbackThreadId = threadToken === "none" ? null : Number.parseInt(threadToken, 10);
  const action = payloadParts[1] ?? "";
  const rootIndex =
    payloadParts[2] !== undefined ? Number.parseInt(payloadParts[2], 10) : Number.NaN;
  const childIndex =
    payloadParts[3] !== undefined ? Number.parseInt(payloadParts[3], 10) : Number.NaN;
  const targetSessionId = payloadParts[2] ?? "";

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "delete_session");
  if (!isActiveMenu) {
    return true;
  }

  try {
    const currentProject = getCurrentProjectForScope(callbackThreadId, ctx.chat?.id ?? null);
    if (!currentProject) {
      clearActiveInlineMenu("delete_sessions_project_missing", ctx);
      await ctx.answerCallbackQuery();
      await ctx.reply(t("delete_sessions.select_project_first"));
      return true;
    }

    const localeForDate = getLocale() === "ru" ? "ru-RU" : "en-US";
    const rootSessions = await loadRootSessionsForMenu(currentProject.worktree);

    if (rootSessions.length === 0) {
      clearActiveInlineMenu("delete_sessions_empty_after_callback", ctx);
      await ctx.editMessageText(t("delete_sessions.empty"));
      await ctx.answerCallbackQuery();
      return true;
    }

    if (action === "l") {
      const rootMenuKeyboard = buildRootDeleteMenu(rootSessions, threadToken, localeForDate);
      try {
        await ctx.editMessageText(t("delete_sessions.select"), {
          reply_markup: appendInlineMenuCancelButton(rootMenuKeyboard, "delete_session"),
        });
      } catch (error) {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if ((action === "h" || action === "r" || action === "m") && !Number.isFinite(rootIndex)) {
      throw new Error(`Invalid root index for action ${action}`);
    }

    if (action === "h") {
      const mainSession = rootSessions[rootIndex];
      if (!mainSession) {
        throw new Error(`Invalid root session index: ${rootIndex}`);
      }

      const subMenuKeyboard = buildSubDeleteMenu(
        mainSession,
        rootIndex,
        threadToken,
        localeForDate,
      );
      try {
        await ctx.editMessageText(t("delete_sessions.select_sub"), {
          reply_markup: subMenuKeyboard,
        });
      } catch (error) {
        if (!isMessageNotModifiedError(error)) {
          throw error;
        }
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (action === "r" || action === "m" || action === "c") {
      let selectedSession: SessionWithChildren | undefined;

      if (action === "c") {
        if (!Number.isFinite(rootIndex) || !Number.isFinite(childIndex)) {
          throw new Error("Invalid child selection indexes");
        }

        const mainSession = rootSessions[rootIndex];
        selectedSession = mainSession?.children?.[childIndex];
      } else {
        selectedSession = rootSessions[rootIndex];
      }

      if (!selectedSession) {
        throw new Error("Selected session not found");
      }

      const cascadeDeleteIds = getCascadeDeleteIds(rootSessions, selectedSession.id);
      const isCascadeDelete = cascadeDeleteIds.length > 1;
      const confirmText = isCascadeDelete
        ? t("delete_sessions.confirm_cascade", {
            title: selectedSession.title,
            count: cascadeDeleteIds.length - 1,
          })
        : t("delete_sessions.confirm_single", { title: selectedSession.title });

      const confirmKeyboard = buildDeleteConfirmMenu(threadToken, selectedSession.id);
      await ctx.editMessageText(confirmText, {
        reply_markup: confirmKeyboard,
      });
      await ctx.answerCallbackQuery();
      return true;
    }

    if (action === "x") {
      if (!targetSessionId) {
        throw new Error("Target session id is missing for delete confirmation");
      }

      const deleteIds = getCascadeDeleteIds(rootSessions, targetSessionId);
      const deletedIds = new Set<string>();

      for (const sessionId of deleteIds) {
        const { error } = await opencodeClient.session.delete({
          sessionID: sessionId,
          directory: currentProject.worktree,
        });

        if (error) {
          throw error;
        }

        deletedIds.add(sessionId);
      }

      const threadScopedCurrentSession = getCurrentSessionByThread(
        Number.isNaN(callbackThreadId as number) ? null : callbackThreadId,
        ctx.chat?.id ?? null,
      );
      if (threadScopedCurrentSession && deletedIds.has(threadScopedCurrentSession.id)) {
        clearSessionByThread(
          Number.isNaN(callbackThreadId as number) ? null : callbackThreadId,
          ctx.chat?.id ?? null,
        );
      }

      const currentSession = getCurrentSession();
      if (currentSession && deletedIds.has(currentSession.id)) {
        clearSession();
      }

      if (
        pinnedMessageManager.isInitialized() &&
        pinnedMessageManager.getState().chatId === (ctx.chat?.id ?? null) &&
        pinnedMessageManager.getState().threadId ===
          (Number.isNaN(callbackThreadId as number) ? null : callbackThreadId) &&
        pinnedMessageManager.getState().sessionId !== null &&
        deletedIds.has(pinnedMessageManager.getState().sessionId as string)
      ) {
        await pinnedMessageManager.clear();
        keyboardManager.clearContext();
      }

      const refreshedRootSessions = await loadRootSessionsForMenu(currentProject.worktree);
      if (refreshedRootSessions.length === 0) {
        clearActiveInlineMenu("delete_sessions_empty_after_delete", ctx);
        await ctx.editMessageText(t("delete_sessions.empty"));
      } else {
        const refreshedKeyboard = buildRootDeleteMenu(
          refreshedRootSessions,
          threadToken,
          localeForDate,
        );
        await ctx.editMessageText(t("delete_sessions.deleted", { count: deletedIds.size }), {
          reply_markup: appendInlineMenuCancelButton(refreshedKeyboard, "delete_session"),
        });
      }

      await ctx.answerCallbackQuery();
      return true;
    }

    await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
  } catch (error) {
    logger.error("[DeleteSessions] Error handling delete sessions callback:", error);
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(t("delete_sessions.delete_error"));
  }

  return true;
}
