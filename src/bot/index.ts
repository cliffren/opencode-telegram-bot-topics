import { Bot, Context, InlineKeyboard, InputFile, NextFunction } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { unknownCommandMiddleware } from "./middleware/unknown-command.js";
import { BOT_COMMANDS } from "./commands/definitions.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { statusCommand } from "./commands/status.js";
import { MODEL_BUTTON_TEXT_PATTERN, VARIANT_BUTTON_TEXT_PATTERN } from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { stopCommand } from "./commands/stop.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { handleAgentCommand } from "./commands/agent.js";
import { handleModelCommand } from "./commands/model.js";
import { renameCommand, handleRenameCancel, handleRenameTextAnswer } from "./commands/rename.js";
import {
  findFileCandidatesForRequest,
  sendfileCommand,
  sendFileByApi,
} from "./commands/sendfile.js";
import { captureAndSendScreenshot, isScreenshotRequestText, screenshotCommand } from "./commands/screenshot.js";
import { processExternalSendFileRequests } from "./external/sendfile-requests.js";
import {
  handleQuestionCallback,
  showCurrentQuestion,
  handleQuestionTextAnswer,
} from "./handlers/question.js";
import { handlePermissionCallback, showPermissionRequest } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import { handleModelSelect, showModelSelectionMenu } from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import { handleContextButtonPress, handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { subscribeToEvents } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatSummary, formatToolInfo } from "../summary/formatter.js";
import { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { getCurrentSession } from "../session/manager.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { t } from "../i18n/index.js";
import { processUserPrompt } from "./handlers/prompt.js";
import { getCurrentSessionByThread } from "./handlers/prompt.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleImageMessage } from "./handlers/image.js";

let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
let threadIdInstance: number | null = null;
let commandsInitialized = false;

type SessionRouteContext = {
  chatId: number;
  threadId: number | null;
  directory: string;
};

const sessionRouteContextBySessionId = new Map<string, SessionRouteContext>();

function bindSessionRouteContext(sessionId: string, context: SessionRouteContext): void {
  sessionRouteContextBySessionId.set(sessionId, context);
}

function getSessionRouteContext(sessionId: string): SessionRouteContext | null {
  return sessionRouteContextBySessionId.get(sessionId) ?? null;
}

function syncThreadRouteContext(ctx: Context): void {
  const threadId = getThreadId(ctx);
  const session = getCurrentSessionByThread(threadId, ctx.chat?.id ?? null);
  if (!session || !ctx.chat) {
    return;
  }

  bindSessionRouteContext(session.id, {
    chatId: ctx.chat.id,
    threadId,
    directory: session.directory,
  });
}

function getThreadId(ctx: Context): number | null {
  return ctx.message?.message_thread_id ?? null;
}

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;
const SEND_FILE_DIRECTIVE_REGEX = /\[\[SEND_FILE:\s*([^\]]+?)\s*\]\]/g;
const SEND_FILE_INLINE_COMMAND_REGEX = /`\s*\/sendfile\s+([^`]+?)\s*`/gi;
const SEND_FILE_LINE_COMMAND_REGEX = /^\s*\/?sendfile\s+(.+?)\s*$/i;
const FILE_PATH_IN_BACKTICKS_REGEX = /`([^`]+\.[a-z0-9]{1,8})`/gi;
const FILE_PATH_GENERIC_REGEX = /(?:\.{1,2}\/|\/)[^\s"'`，。；;]+\.[a-z0-9]{1,8}/gi;
const AUTO_SEND_SIGNAL_REGEX = /(已发送|已经发送|发送给你|发给你|send(?:ing)?\s+(?:it|file)?\s*to\s+you|downloaded|saved|已下载|已保存|保存到|generated|已生成)/i;
const MAX_AUTO_FILES_PER_MESSAGE = 3;
const SEND_FILE_SELECTION_PREFIX = "sendfile_select:";
const SEND_FILE_SELECTION_CANCEL_PREFIX = "sendfile_cancel:";
const SEND_FILE_SELECTION_TTL_MS = 5 * 60_000;
const SEND_FILE_SELECTION_MAX_CANDIDATES = 5;
const TEMP_DIR = config.files.tempDir || path.join(os.tmpdir(), "opencode-telegram");

type PendingSendFileSelection = {
  chatId: number;
  threadId: number | null;
  requestedPath: string;
  candidates: string[];
  createdAt: number;
};

const pendingSendFileSelections = new Map<string, PendingSendFileSelection>();

type SendFileDirectiveParseResult = {
  sanitizedText: string;
  filePaths: string[];
};

function parseSendFileDirectives(text: string): SendFileDirectiveParseResult {
  const filePaths: string[] = [];

  const withDirectiveMarkersRemoved = text.replace(
    SEND_FILE_DIRECTIVE_REGEX,
    (_fullMatch: string, rawPath: string) => {
      const trimmedPath = rawPath.trim();
      if (trimmedPath) {
        filePaths.push(trimmedPath);
      }
      return "";
    },
  );

  const withInlineCommandsRemoved = withDirectiveMarkersRemoved.replace(
    SEND_FILE_INLINE_COMMAND_REGEX,
    (_fullMatch: string, rawPath: string) => {
      const trimmedPath = rawPath.trim();
      if (trimmedPath) {
        filePaths.push(trimmedPath);
      }
      return "";
    },
  );

  const keptLines: string[] = [];
  for (const line of withInlineCommandsRemoved.split("\n")) {
    const match = line.match(SEND_FILE_LINE_COMMAND_REGEX);
    if (match && match[1]) {
      const trimmedPath = match[1].trim();
      if (trimmedPath) {
        filePaths.push(trimmedPath);
      }
      continue;
    }

    keptLines.push(line);
  }

  const sanitizedText = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(
    SEND_FILE_DIRECTIVE_REGEX,
    (_fullMatch: string, rawPath: string) => {
      const trimmedPath = rawPath.trim();
      if (trimmedPath) {
        filePaths.push(trimmedPath);
      }
      return "";
    },
  );

  const dedupedPaths = Array.from(new Set(filePaths));

  return {
    sanitizedText: sanitizedText.trim(),
    filePaths: dedupedPaths,
  };
}

function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(?:\.\.?[\\/]|~[\\/]|[a-zA-Z]:[\\/]|\/)/.test(trimmed)) {
    return true;
  }

  if (/[\\/]/.test(trimmed)) {
    return true;
  }

  if (/[^\s]+\.[a-zA-Z0-9]{1,8}$/.test(trimmed)) {
    return true;
  }

  return false;
}

function parseNaturalSendFileRequest(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const patterns = [
    /(?:把|将)\s*`([^`]+)`\s*(?:发送|发)\s*(?:给我|给我看|给我一下|给我下|给我吧)/i,
    /(?:发送|发)\s*`([^`]+)`\s*(?:给我|给我看|给我一下|给我下|给我吧)/i,
    /send\s+`([^`]+)`\s+to\s+me/i,
    /(?:把|将)\s*(\S+)\s*(?:发送|发)\s*(?:给我|给我看|给我一下|给我下|给我吧)/i,
    /(?:发送|发)\s*(\S+)\s*(?:给我|给我看|给我一下|给我下|给我吧)/i,
    /send\s+(\S+)\s+to\s+me/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (looksLikeFilePath(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function extractAutoSendCandidatePaths(text: string): string[] {
  const candidates: string[] = [];

  for (const match of text.matchAll(FILE_PATH_IN_BACKTICKS_REGEX)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  for (const match of text.matchAll(FILE_PATH_GENERIC_REGEX)) {
    const candidate = match[0]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return Array.from(new Set(candidates));
}

function parseAutoSendFilePathsFromAssistantText(text: string): string[] {
  if (!AUTO_SEND_SIGNAL_REGEX.test(text)) {
    return [];
  }

  return extractAutoSendCandidatePaths(text).slice(0, MAX_AUTO_FILES_PER_MESSAGE);
}

function cleanupExpiredSendFileSelections(): void {
  const now = Date.now();
  for (const [token, selection] of pendingSendFileSelections.entries()) {
    if (now - selection.createdAt > SEND_FILE_SELECTION_TTL_MS) {
      pendingSendFileSelections.delete(token);
    }
  }
}

function createSendFileSelectionKeyboard(token: string, candidates: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const labelRaw = path.basename(candidate) || candidate;
    const label = labelRaw.length > 48 ? `${labelRaw.slice(0, 45)}...` : labelRaw;
    keyboard.text(label, `${SEND_FILE_SELECTION_PREFIX}${token}:${i}`).row();
  }

  keyboard.text(t("sendfile.choice.cancel"), `${SEND_FILE_SELECTION_CANCEL_PREFIX}${token}`);
  return keyboard;
}

async function replySendFileFailure(ctx: Context, reason: "not_found" | "not_file" | "too_large" | "send_error"): Promise<void> {
  if (reason === "not_found") {
    await ctx.reply(t("sendfile.file_not_found"));
    return;
  }

  if (reason === "not_file") {
    await ctx.reply(t("sendfile.not_a_file"));
    return;
  }

  if (reason === "too_large") {
    await ctx.reply(t("sendfile.too_large_unknown", { limit: config.files.maxFileSizeKb }));
    return;
  }

  await ctx.reply(t("sendfile.error"));
}

async function handleNaturalSendFileRequest(ctx: Context, requestedPath: string): Promise<void> {
  cleanupExpiredSendFileSelections();

  if (!ctx.chat) {
    return;
  }

  const threadId = getThreadId(ctx);
  const chatId = ctx.chat.id;
  const candidates = await findFileCandidatesForRequest(requestedPath);

  if (candidates.length === 0) {
    await ctx.reply(t("sendfile.file_not_found"));
    return;
  }

  if (candidates.length === 1) {
    const result = await sendFileByApi(ctx.api, chatId, threadId, candidates[0]);
    if (!result.ok) {
      await replySendFileFailure(ctx, result.reason);
    }
    return;
  }

  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pendingSendFileSelections.set(token, {
    chatId,
    threadId,
    requestedPath,
    candidates,
    createdAt: Date.now(),
  });

  const limitedCandidates = candidates.slice(0, SEND_FILE_SELECTION_MAX_CANDIDATES);
  await ctx.reply(
    t("sendfile.multiple_found", {
      path: requestedPath,
      count: String(candidates.length),
    }),
    {
      reply_markup: createSendFileSelectionKeyboard(token, limitedCandidates),
      message_thread_id: threadId ?? undefined,
    },
  );
}

async function handleSendFileSelectionCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  if (data.startsWith(SEND_FILE_SELECTION_CANCEL_PREFIX)) {
    const token = data.slice(SEND_FILE_SELECTION_CANCEL_PREFIX.length);
    pendingSendFileSelections.delete(token);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t("sendfile.choice.cancelled"));
    return true;
  }

  if (!data.startsWith(SEND_FILE_SELECTION_PREFIX)) {
    return false;
  }

  const payload = data.slice(SEND_FILE_SELECTION_PREFIX.length);
  const separatorIndex = payload.lastIndexOf(":");
  if (separatorIndex < 0) {
    await ctx.answerCallbackQuery({ text: t("sendfile.choice.expired"), show_alert: false });
    return true;
  }

  const token = payload.slice(0, separatorIndex);
  const indexRaw = payload.slice(separatorIndex + 1);
  const index = Number.parseInt(indexRaw, 10);

  const selection = pendingSendFileSelections.get(token);
  if (!selection || Number.isNaN(index) || index < 0 || index >= selection.candidates.length) {
    await ctx.answerCallbackQuery({ text: t("sendfile.choice.expired"), show_alert: false });
    return true;
  }

  pendingSendFileSelections.delete(token);
  await ctx.answerCallbackQuery();

  const chosenPath = selection.candidates[index];
  const result = await sendFileByApi(ctx.api, selection.chatId, selection.threadId, chosenPath);
  if (!result.ok) {
    await ctx.editMessageText(t("sendfile.choice.failed", { path: selection.requestedPath }));
    return true;
  }

  await ctx.editMessageText(t("sendfile.choice.sent", { path: result.absolutePath }));
  return true;
}

async function sendRequestedFiles(
  bot: Bot<Context>,
  chatId: number,
  threadId: number | null,
  baseDirectory: string,
  filePaths: string[],
): Promise<void> {
  for (const requestedPath of filePaths) {
    const absolutePath = path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(baseDirectory, requestedPath);

    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        logger.warn(`[Bot] SEND_FILE skipped non-file path: ${absolutePath}`);
        continue;
      }

      const sizeKb = Math.floor(stats.size / 1024);
      if (sizeKb > config.files.maxFileSizeKb) {
        logger.warn(
          `[Bot] SEND_FILE skipped oversized file: ${absolutePath} (${sizeKb}KB > ${config.files.maxFileSizeKb}KB)`,
        );
        continue;
      }

      await bot.api.sendDocument(chatId, new InputFile(absolutePath), {
        caption: prepareDocumentCaption(requestedPath),
        message_thread_id: threadId ?? undefined,
      });

      logger.info(`[Bot] SEND_FILE sent document: ${absolutePath}`);
    } catch (err) {
      logger.warn(`[Bot] SEND_FILE failed for path: ${absolutePath}`, err);
    }
  }
}

function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

const toolMessageBatcher = new ToolMessageBatcher({
  intervalSeconds: 5,
  sendText: async (sessionId, text) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    await botInstance.api.sendMessage(chatIdInstance, text, {
      disable_notification: true,
      message_thread_id: threadIdInstance ?? undefined,
    });
  },
  sendFile: async (sessionId, fileData) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    const tempFilePath = path.join(TEMP_DIR, fileData.filename);

    try {
      logger.debug(
        `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes, session=${sessionId})`,
      );

      await fs.mkdir(TEMP_DIR, { recursive: true });
      await fs.writeFile(tempFilePath, fileData.buffer);

      await botInstance.api.sendDocument(chatIdInstance, new InputFile(tempFilePath), {
        caption: fileData.caption,
        disable_notification: true,
        message_thread_id: threadIdInstance ?? undefined,
      });
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  },
});

const STATUS_PREVIEW_MAX_LENGTH = 32;
const THINKING_ANIMATION_INTERVAL_MS = 1000;
const THINKING_DOT_FRAMES = [".", "..", "..."] as const;
const STATUS_POST_COMPLETE_SUPPRESS_MS = 2000;

function toSingleLineStatusPreview(text: string, maxLength: number = STATUS_PREVIEW_MAX_LENGTH): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`;
}

interface SessionStatusSlot {
  messageId: number;
  lastText: string;
}

const sessionStatusSlots = new Map<string, SessionStatusSlot>();
const sessionStatusTasks = new Map<string, Promise<void>>();
const thinkingAnimations = new Map<string, ReturnType<typeof setInterval>>();
const sessionStatusCompletedAt = new Map<string, number>();

function clearSessionCompletionGuardByContext(ctx: Context): void {
  const threadId = getThreadId(ctx);
  const session = getCurrentSessionByThread(threadId, ctx.chat?.id ?? null);
  if (!session) {
    return;
  }

  sessionStatusCompletedAt.delete(session.id);
}

function shouldSuppressPostCompleteStatus(sessionId: string): boolean {
  const completedAt = sessionStatusCompletedAt.get(sessionId);
  if (!completedAt) {
    return false;
  }

  if (Date.now() - completedAt <= STATUS_POST_COMPLETE_SUPPRESS_MS) {
    return true;
  }

  sessionStatusCompletedAt.delete(sessionId);
  return false;
}

function buildThinkingStatusText(frameIndex: number): string {
  const base = t("bot.thinking").trim().replace(/[.。…]+$/u, "").trimEnd();
  const dots = THINKING_DOT_FRAMES[frameIndex % THINKING_DOT_FRAMES.length];
  if (base.startsWith("💭 ")) {
    const label = base.slice(2);
    return `💭[${label}${dots.padEnd(3, " ")}]`;
  }

  return `[${base}${dots.padEnd(3, " ")}]`;
}

function stopThinkingAnimation(sessionId: string): void {
  const timer = thinkingAnimations.get(sessionId);
  if (!timer) {
    return;
  }

  clearInterval(timer);
  thinkingAnimations.delete(sessionId);
}

function stopAllThinkingAnimations(): void {
  for (const timer of thinkingAnimations.values()) {
    clearInterval(timer);
  }
  thinkingAnimations.clear();
}

function startThinkingAnimation(sessionId: string): void {
  if (thinkingAnimations.has(sessionId)) {
    return;
  }

  let nextFrameIndex = 1;
  const timer = setInterval(() => {
    if (!thinkingAnimations.has(sessionId)) {
      return;
    }

    const frameText = buildThinkingStatusText(nextFrameIndex);
    nextFrameIndex = (nextFrameIndex + 1) % THINKING_DOT_FRAMES.length;
    void enqueueSessionStatusTask(sessionId, () => updateSessionStatusMessage(sessionId, frameText));
  }, THINKING_ANIMATION_INTERVAL_MS);

  thinkingAnimations.set(sessionId, timer);
}

function enqueueSessionStatusTask(sessionId: string, task: () => Promise<void>): Promise<void> {
  const previous = sessionStatusTasks.get(sessionId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (sessionStatusTasks.get(sessionId) === next) {
        sessionStatusTasks.delete(sessionId);
      }
    });

  sessionStatusTasks.set(sessionId, next);
  return next;
}

function isMessageNotModifiedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("message is not modified");
}

function canRecoverBySendingNewMessage(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("message to edit not found") ||
    message.includes("message can't be edited") ||
    message.includes("message is too old") ||
    message.includes("message_id_invalid")
  );
}

async function updateSessionStatusMessage(sessionId: string, text: string): Promise<void> {
  if (!botInstance) {
    return;
  }

  const routeContext = getSessionRouteContext(sessionId);
  if (!routeContext) {
    return;
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }

  const existingSlot = sessionStatusSlots.get(sessionId);
  if (!existingSlot) {
    const message = await botInstance.api.sendMessage(routeContext.chatId, normalizedText, {
      disable_notification: true,
      message_thread_id: routeContext.threadId ?? undefined,
    });
    sessionStatusSlots.set(sessionId, { messageId: message.message_id, lastText: normalizedText });
    return;
  }

  if (existingSlot.lastText === normalizedText) {
    return;
  }

  try {
    await botInstance.api.editMessageText(routeContext.chatId, existingSlot.messageId, normalizedText);
    sessionStatusSlots.set(sessionId, { ...existingSlot, lastText: normalizedText });
  } catch (error) {
    if (isMessageNotModifiedError(error)) {
      return;
    }

    if (!canRecoverBySendingNewMessage(error)) {
      throw error;
    }

    const message = await botInstance.api.sendMessage(routeContext.chatId, normalizedText, {
      disable_notification: true,
      message_thread_id: routeContext.threadId ?? undefined,
    });
    sessionStatusSlots.set(sessionId, { messageId: message.message_id, lastText: normalizedText });
  }
}

async function ensureCommandsInitialized(ctx: Context, next: NextFunction): Promise<void> {
  if (commandsInitialized || !ctx.from || ctx.from.id !== config.telegram.allowedUserId) {
    await next();
    return;
  }

  if (!ctx.chat) {
    logger.warn("[Bot] Cannot initialize commands: chat context is missing");
    await next();
    return;
  }

  try {
    await ctx.api.setMyCommands(BOT_COMMANDS, {
      scope: {
        type: "chat",
        chat_id: ctx.chat.id,
      },
    });

    commandsInitialized = true;
    logger.info(`[Bot] Commands initialized for authorized user (chat_id=${ctx.chat.id})`);
  } catch (err) {
    logger.error("[Bot] Failed to set commands:", err);
  }

  await next();
}

async function ensureEventSubscription(directory: string): Promise<void> {
  if (!directory) {
    logger.error("No directory found for event subscription");
    return;
  }

  toolMessageBatcher.setIntervalSeconds(config.bot.serviceMessagesIntervalSec);
  summaryAggregator.setOnCleared(() => {
    toolMessageBatcher.clearAll("summary_aggregator_clear");
    sessionStatusSlots.clear();
    sessionStatusTasks.clear();
    stopAllThinkingAnimations();
    sessionStatusCompletedAt.clear();
  });

  summaryAggregator.setOnComplete(async (sessionId, messageText) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for sending message");
      return;
    }
    const botApi = botInstance.api;

    const routeContext = getSessionRouteContext(sessionId);
    if (!routeContext) {
      return;
    }

    stopThinkingAnimation(sessionId);
    sessionStatusCompletedAt.set(sessionId, Date.now());
    await toolMessageBatcher.flushSession(sessionId, "assistant_message_completed");

    try {
      const { sanitizedText, filePaths } = parseSendFileDirectives(messageText);

      if (filePaths.length > 0) {
        await sendRequestedFiles(
          botInstance,
          routeContext.chatId,
          routeContext.threadId,
          routeContext.directory,
          filePaths,
        );
      }

      if (filePaths.length === 0) {
        const autoFilePaths = parseAutoSendFilePathsFromAssistantText(messageText);
        if (autoFilePaths.length > 0) {
          logger.info(`[Bot] Auto-send detected file paths: ${autoFilePaths.join(", ")}`);
          await sendRequestedFiles(
            botInstance,
            routeContext.chatId,
            routeContext.threadId,
            routeContext.directory,
            autoFilePaths,
          );
        }
      }

      const textToSend = sanitizedText.length > 0 ? sanitizedText : filePaths.length > 0 ? "" : messageText;
      const parts = textToSend ? formatSummary(textToSend) : [];

      logger.debug(
        `[Bot] Sending completed message to Telegram (chatId=${routeContext.chatId}, threadId=${routeContext.threadId}, parts=${parts.length})`,
      );
      await enqueueSessionStatusTask(sessionId, async () => {
        const messageThreadId = routeContext.threadId ?? undefined;
        const statusSlot = sessionStatusSlots.get(sessionId);

        if (parts.length > 0 && statusSlot) {
          try {
            await botApi.editMessageText(routeContext.chatId, statusSlot.messageId, parts[0]);
            sessionStatusSlots.delete(sessionId);
          } catch (error) {
            if (!isMessageNotModifiedError(error) && !canRecoverBySendingNewMessage(error)) {
              throw error;
            }

            const sent = await botApi.sendMessage(routeContext.chatId, parts[0], {
              message_thread_id: messageThreadId,
            });
            sessionStatusSlots.delete(sessionId);
            logger.debug(
              `[Bot] Replaced final response via new message after edit failure (session=${sessionId}, messageId=${sent.message_id})`,
            );
          }

          for (let i = 1; i < parts.length; i++) {
            const isLastPart = i === parts.length - 1;
            if (isLastPart && keyboardManager.isInitialized()) {
              const keyboardForLastPart = keyboardManager.getKeyboard();
              await botApi.sendMessage(routeContext.chatId, parts[i], {
                reply_markup: keyboardForLastPart ?? undefined,
                message_thread_id: messageThreadId,
              });
            } else {
              await botApi.sendMessage(routeContext.chatId, parts[i], {
                message_thread_id: messageThreadId,
              });
            }
          }

          return;
        }

        for (let i = 0; i < parts.length; i++) {
          const isLastPart = i === parts.length - 1;
          if (isLastPart && keyboardManager.isInitialized()) {
            // Attach updated keyboard to the last message part (only if initialized)
            const keyboard = keyboardManager.getKeyboard();
            await botApi.sendMessage(routeContext.chatId, parts[i], {
              reply_markup: keyboard ?? undefined,
              message_thread_id: messageThreadId,
            });
          } else {
            await botApi.sendMessage(routeContext.chatId, parts[i], {
              message_thread_id: messageThreadId,
            });
          }
        }
      });
    } catch (err) {
      logger.error("Failed to send message to Telegram:", err);
      // Stop processing events after critical error to prevent infinite loop
      logger.error("[Bot] CRITICAL: Stopping event processing due to error");
      summaryAggregator.clear();
    }
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    const routeContext = getSessionRouteContext(toolInfo.sessionId);
    if (!routeContext) {
      return;
    }

    try {
      if (shouldSuppressPostCompleteStatus(toolInfo.sessionId)) {
        return;
      }

      const message = formatToolInfo(toolInfo);
      if (message) {
        stopThinkingAnimation(toolInfo.sessionId);
        const preview = toSingleLineStatusPreview(message);
        await enqueueSessionStatusTask(toolInfo.sessionId, () =>
          updateSessionStatusMessage(toolInfo.sessionId, preview),
        );
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnToolFile(async (fileInfo) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    const routeContext = getSessionRouteContext(fileInfo.sessionId);
    if (!routeContext) {
      return;
    }

    try {
      const toolMessage = formatToolInfo(fileInfo);
      const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

      toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
        ...fileInfo.fileData,
        caption,
      });
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    }
  });

  summaryAggregator.setOnQuestion(async (questions, requestID) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for showing questions");
      return;
    }

    const activeSession = getCurrentSession();
    if (activeSession) {
      await toolMessageBatcher.flushSession(activeSession.id, "question_asked");
    }

    const inferredSessionId = activeSession?.id;
    const routeContext = inferredSessionId ? getSessionRouteContext(inferredSessionId) : null;
    const targetChatId = routeContext?.chatId ?? chatIdInstance;
    if (!targetChatId) {
      return;
    }

    if (questionManager.isActive()) {
      logger.warn("[Bot] Replacing active poll with a new one");

      const previousMessageIds = questionManager.getMessageIds();
      for (const messageId of previousMessageIds) {
        await botInstance.api.deleteMessage(targetChatId, messageId).catch(() => {});
      }

      clearAllInteractionState("question_replaced_by_new_poll");
    }

    logger.info(`[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`);
    questionManager.startQuestions(questions, requestID);
    await showCurrentQuestion(botInstance.api, targetChatId);
  });

  summaryAggregator.setOnQuestionError(async () => {
    logger.info(`[Bot] Question tool failed, clearing active poll and deleting messages`);

    // Delete all messages from the invalid poll
    const messageIds = questionManager.getMessageIds();
    for (const messageId of messageIds) {
      if (chatIdInstance) {
        await botInstance?.api.deleteMessage(chatIdInstance, messageId).catch((err) => {
          logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
        });
      }
    }

    clearAllInteractionState("question_error");
  });

  summaryAggregator.setOnPermission(async (request) => {
    if (!botInstance) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    await toolMessageBatcher.flushSession(request.sessionID, "permission_asked");

    logger.info(
      `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
    );
    const routeContext = getSessionRouteContext(request.sessionID);
    const targetChatId = routeContext?.chatId ?? chatIdInstance;
    if (!targetChatId) {
      return;
    }

    await showPermissionRequest(botInstance.api, targetChatId, request);
  });

  summaryAggregator.setOnThinking(async (sessionId) => {
    if (!botInstance) {
      return;
    }

    const routeContext = getSessionRouteContext(sessionId);
    if (!routeContext) {
      return;
    }

    logger.debug("[Bot] Agent started thinking");

    await enqueueSessionStatusTask(sessionId, () =>
      updateSessionStatusMessage(sessionId, buildThinkingStatusText(0)),
    );
    startThinkingAnimation(sessionId);
  });

  summaryAggregator.setOnTokens(async (tokens) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.debug(`[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}`);

      // Update keyboardManager SYNCHRONOUSLY before any await
      // This ensures keyboard has correct context when onComplete sends the reply
      const contextSize = tokens.input + tokens.cacheRead;
      const contextLimit = pinnedMessageManager.getContextLimit();
      if (contextLimit > 0) {
        keyboardManager.updateContext(contextSize, contextLimit);
      }

      await pinnedMessageManager.onMessageComplete(tokens);
    } catch (err) {
      logger.error("[Bot] Error updating pinned message with tokens:", err);
    }
  });

  summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
      await pinnedMessageManager.onSessionCompacted(sessionId, directory);
    } catch (err) {
      logger.error("[Bot] Error reloading context after compaction:", err);
    }
  });

  summaryAggregator.setOnSessionError(async (sessionId, message) => {
    if (!botInstance || !chatIdInstance) {
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return;
    }

    stopThinkingAnimation(sessionId);
    await toolMessageBatcher.flushSession(sessionId, "session_error");

    const normalizedMessage = message.trim() || t("common.unknown_error");
    const truncatedMessage =
      normalizedMessage.length > 3500
        ? `${normalizedMessage.slice(0, 3497)}...`
        : normalizedMessage;

    await botInstance.api
      .sendMessage(chatIdInstance, t("bot.session_error", { message: truncatedMessage }), {
        message_thread_id: threadIdInstance ?? undefined,
      })
      .catch((err) => {
        logger.error("[Bot] Failed to send session.error message:", err);
      });
  });

  summaryAggregator.setOnSessionDiff(async (_sessionId, diffs) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      await pinnedMessageManager.onSessionDiff(diffs);
    } catch (err) {
      logger.error("[Bot] Error updating session diff:", err);
    }
  });

  summaryAggregator.setOnFileChange((change) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }
    pinnedMessageManager.addFileChange(change);
  });

  pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
    try {
      logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
      keyboardManager.updateContext(tokensUsed, tokensLimit);
      // Don't send automatic keyboard updates - keyboard will update naturally with user messages
    } catch (err) {
      logger.error("[Bot] Error updating keyboard context:", err);
    }
  });

  logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
  subscribeToEvents(directory, (event) => {
    if (event.type === "session.created" || event.type === "session.updated") {
      const info = (
        event.properties as { info?: { directory?: string; time?: { updated?: number } } }
      ).info;

      if (info?.directory) {
        safeBackgroundTask({
          taskName: `session.cache.${event.type}`,
          task: () => ingestSessionInfoForCache(info),
        });
      }
    }

    summaryAggregator.processEvent(event);
  }).catch((err) => {
    logger.error("Failed to subscribe to events:", err);
  });
}

export function createBot(): Bot<Context> {
  clearAllInteractionState("bot_startup");
  toolMessageBatcher.setIntervalSeconds(config.bot.serviceMessagesIntervalSec);
  logger.info(`[ToolBatcher] Service messages interval: ${config.bot.serviceMessagesIntervalSec}s`);

  const botOptions: ConstructorParameters<typeof Bot<Context>>[1] = {};

  if (config.telegram.proxyUrl) {
    const proxyUrl = config.telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    };
  }

  const bot = new Bot(config.telegram.token, botOptions);

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

  setInterval(() => {
    cleanupExpiredSendFileSelections();

    if (!botInstance) {
      return;
    }

    void processExternalSendFileRequests(botInstance, chatIdInstance, threadIdInstance);
  }, config.external.sendFileRequestPollIntervalMs);

  // Log all API calls for diagnostics
  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
    } else if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }
    return prev(method, payload, signal);
  });

  bot.use((ctx, next) => {
    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(ensureCommandsInitialized);
  bot.use(interactionGuardMiddleware);

  const blockMenuWhileInteractionActive = async (ctx: Context): Promise<boolean> => {
    const activeInteraction = interactionManager.getSnapshot();
    if (!activeInteraction) {
      return false;
    }

    logger.debug(
      `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}`,
    );
    await ctx.reply(t("interaction.blocked.finish_current"));
    return true;
  };

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("new", newCommand);
  bot.command("agent", handleAgentCommand);
  bot.command("model", handleModelCommand);
  bot.command("stop", stopCommand);
  bot.command("rename", renameCommand);
  bot.command("screenshot", screenshotCommand);
  bot.command("sendfile", sendfileCommand);

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    try {
      const handledSendFileSelection = await handleSendFileSelectionCallback(ctx);
      if (handledSendFileSelection) {
        return;
      }

      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      const handledSession = await handleSessionSelect(ctx);
      const handledProject = await handleProjectSelect(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);

      logger.debug(
        `[Bot] Callback handled: sendFileSelection=${handledSendFileSelection}, inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, rename=${handledRenameCancel}`,
      );

      if (
        !handledSendFileSelection &&
        !handledInlineCancel &&
        !handledSession &&
        !handledProject &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledRenameCancel
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState("callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  bot.hears(/^(📋|🛠️|💬|🔍|📝|📄|📦|🤖|🔄|🔨|🔮|📚|🗺️|🔥|🦉|🎭|👁️|🐣|⚡) .+ Mode$/, async (ctx) => {

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  // Model button text is produced by formatModelForButton() and always starts with "🤖 ".
  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  // Handle Reply Keyboard button press (context button)
  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  // Handle Reply Keyboard button press (variant selector)
  // Keep support for both legacy "💭" and current "💡" prefix.
  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showVariantSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  // Remove any previously set global commands to prevent unauthorized users from seeing them
  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.info("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  // Voice and audio message handlers (STT transcription -> prompt)
  const voicePromptDeps = { bot, ensureEventSubscription };

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}, threadId=${getThreadId(ctx)}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    threadIdInstance = getThreadId(ctx);
    clearSessionCompletionGuardByContext(ctx);
    await handleVoiceMessage(ctx, voicePromptDeps);
    syncThreadRouteContext(ctx);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}, threadId=${getThreadId(ctx)}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    threadIdInstance = getThreadId(ctx);
    clearSessionCompletionGuardByContext(ctx);
    await handleVoiceMessage(ctx, voicePromptDeps);
    syncThreadRouteContext(ctx);
  });

  // Photo message handler - download and send to OpenCode
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}, threadId=${getThreadId(ctx)}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    threadIdInstance = getThreadId(ctx);
    clearSessionCompletionGuardByContext(ctx);
    const imageDeps = { bot, ensureEventSubscription };
    await handleImageMessage(ctx, imageDeps);
    syncThreadRouteContext(ctx);
  });

  // Document message handler - download and send to OpenCode
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}, threadId=${getThreadId(ctx)}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    threadIdInstance = getThreadId(ctx);
    clearSessionCompletionGuardByContext(ctx);
    const imageDeps = { bot, ensureEventSubscription };
    await handleImageMessage(ctx, imageDeps);
    syncThreadRouteContext(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    if (text.startsWith("/")) {
      return;
    }

    if (questionManager.isActive()) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      return;
    }

    const naturalSendFilePath = parseNaturalSendFileRequest(text);
    if (naturalSendFilePath) {
      await handleNaturalSendFileRequest(ctx, naturalSendFilePath);
      return;
    }

    if (isScreenshotRequestText(text)) {
      await captureAndSendScreenshot(ctx);
      return;
    }

    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    threadIdInstance = getThreadId(ctx);
    clearSessionCompletionGuardByContext(ctx);

    const promptDeps = { bot, ensureEventSubscription };
    await processUserPrompt(ctx, text, promptDeps);
    syncThreadRouteContext(ctx);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    clearAllInteractionState("bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}
