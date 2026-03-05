import { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import {
  applyBgNotify,
  cancelBgTask,
  createBgTask,
  deleteBgTask,
  findBgTask,
  isTerminalTask,
  listBgTasksByScope,
  refreshBgTasksCache,
} from "../../bg/manager.js";
import type { BgPostAction, BgPostActionType, BgTask } from "../../bg/types.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentSessionByThread } from "./prompt.js";
import { getStoredAgent } from "../../agent/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { enqueueBgDispatchRequest } from "../../bg/dispatch-requests.js";

const BG_CALLBACK_PREFIX = "bg:";
const BG_ALLOWED_COMMANDS = ["/help", "/status", "/stop", "/bg"];
const BG_PAGE_SIZE = 5;

type BgStep = "main" | "await_prompt" | "await_post_action_callback" | "await_post_action_custom";

interface BgDraft {
  prompt?: string;
  postActionType?: BgPostActionType;
  postActionPrompt?: string;
}

interface BgInteractionMetadata {
  flow: "bg";
  step: BgStep;
  messageId?: number;
  interactionChatId: number | null;
  interactionThreadId: number | null;
  draft?: BgDraft;
}

function getThreadId(ctx: Context): number | null {
  if (ctx.message?.message_thread_id) {
    return ctx.message.message_thread_id;
  }
  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage && "message_thread_id" in callbackMessage) {
    const threadId = (callbackMessage as { message_thread_id?: number }).message_thread_id;
    return typeof threadId === "number" ? threadId : null;
  }
  return null;
}

function getScope(ctx: Context): { chatId: number | null; threadId: number | null } {
  return {
    chatId: ctx.chat?.id ?? null,
    threadId: getThreadId(ctx),
  };
}

function getActiveBgState(): { state: InteractionState; metadata: BgInteractionMetadata } | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom") {
    return null;
  }
  const metadata = state.metadata as Partial<BgInteractionMetadata>;
  if (metadata.flow !== "bg" || typeof metadata.step !== "string") {
    return null;
  }
  if (
    metadata.step !== "main" &&
    metadata.step !== "await_prompt" &&
    metadata.step !== "await_post_action_callback" &&
    metadata.step !== "await_post_action_custom"
  ) {
    return null;
  }
  return {
    state,
    metadata: {
      flow: "bg",
      step: metadata.step,
      messageId: typeof metadata.messageId === "number" ? metadata.messageId : undefined,
      interactionChatId:
        typeof metadata.interactionChatId === "number" ? metadata.interactionChatId : null,
      interactionThreadId:
        typeof metadata.interactionThreadId === "number" || metadata.interactionThreadId === null
          ? metadata.interactionThreadId
          : null,
      draft: metadata.draft,
    },
  };
}

function getBgExpectedInput(step: BgStep): "callback" | "mixed" {
  // await_post_action_callback waits for a button click only — block text at guard level
  if (step === "main" || step === "await_post_action_callback") return "callback";
  return "mixed";
}

function startBgInteraction(ctx: Context, step: BgStep, messageId?: number, draft?: BgDraft): void {
  const scope = getScope(ctx);
  interactionManager.start({
    kind: "custom",
    expectedInput: getBgExpectedInput(step),
    allowedCommands: BG_ALLOWED_COMMANDS,
    metadata: {
      flow: "bg",
      step,
      messageId,
      interactionChatId: scope.chatId,
      interactionThreadId: scope.threadId,
      draft,
    },
  });
}

function transitionBgInteraction(step: BgStep, metadata: BgInteractionMetadata): void {
  interactionManager.transition({
    expectedInput: getBgExpectedInput(step),
    allowedCommands: BG_ALLOWED_COMMANDS,
    metadata: {
      ...metadata,
      step,
    },
  });
}

function clearBgInteraction(): void {
  const active = getActiveBgState();
  if (!active) {
    return;
  }
  interactionManager.clear("bg_finished");
}

async function removeBgMenuMessage(ctx: Context, metadata: BgInteractionMetadata): Promise<void> {
  if (typeof metadata.messageId !== "number") {
    return;
  }
  const chatId = ctx.chat?.id ?? metadata.interactionChatId;
  if (chatId === null) {
    return;
  }
  await ctx.api.deleteMessage(chatId, metadata.messageId).catch(() => {});
}

function ensureSessionForCreate(
  ctx: Context,
): { id: string; title: string; directory: string } | null {
  const scope = getScope(ctx);
  const scopedSession = getCurrentSessionByThread(scope.threadId, scope.chatId);
  const fallbackSession = getCurrentSession();
  return scopedSession ?? fallbackSession;
}

function formatShortTaskId(taskId: string): string {
  if (taskId.length <= 6) {
    return taskId;
  }
  return taskId.slice(-6);
}

function formatTaskStatus(task: BgTask): string {
  switch (task.status) {
    case "queued":
      return t("bg.status.queued");
    case "running":
      return t("bg.status.running");
    case "succeeded":
      return t("bg.status.succeeded");
    case "failed":
      return t("bg.status.failed");
  }
}

function formatTaskListMessage(chatId: number, threadId: number | null, page: number): string {
  const tasks = listBgTasksByScope(chatId, threadId);
  if (tasks.length === 0) {
    return t("bg.list.empty");
  }
  const maxPage = Math.max(0, Math.ceil(tasks.length / BG_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * BG_PAGE_SIZE;
  const pageItems = tasks.slice(start, start + BG_PAGE_SIZE);
  const lines = pageItems.map((task) => {
    const shortId = formatShortTaskId(task.id);
    return `• [${formatTaskStatus(task)}] ${task.title} (${shortId})`;
  });
  const pageLabel =
    tasks.length > BG_PAGE_SIZE
      ? `\n${t("bg.list.page", { page: safePage + 1, total: maxPage + 1 })}`
      : "";
  return `${t("bg.list.title")}\n\n${lines.join("\n")}${pageLabel}`;
}

function buildMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("bg.menu.button.new"), `${BG_CALLBACK_PREFIX}new`)
    .text(t("bg.menu.button.list"), `${BG_CALLBACK_PREFIX}list`)
    .row()
    .text(t("inline.button.cancel"), `${BG_CALLBACK_PREFIX}cancel`);
}

function buildPostActionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("bg.post.none"), `${BG_CALLBACK_PREFIX}post:none`)
    .text(t("bg.post.summarize"), `${BG_CALLBACK_PREFIX}post:summarize`)
    .row()
    .text(t("bg.post.custom"), `${BG_CALLBACK_PREFIX}post:custom`)
    .row()
    .text(t("bg.menu.button.back"), `${BG_CALLBACK_PREFIX}back`)
    .text(t("inline.button.cancel"), `${BG_CALLBACK_PREFIX}cancel`);
}

function buildTasksKeyboard(chatId: number, threadId: number | null, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const tasks = listBgTasksByScope(chatId, threadId);
  const maxPage = Math.max(0, Math.ceil(tasks.length / BG_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * BG_PAGE_SIZE;
  const pageItems = tasks.slice(start, start + BG_PAGE_SIZE);

  for (const task of pageItems) {
    const shortId = formatShortTaskId(task.id);
    keyboard
      .text(
        t("bg.tasks.button.stop", { id: shortId }),
        `${BG_CALLBACK_PREFIX}stop:${task.id}:${safePage}`,
      )
      .text(
        t("bg.tasks.button.restart", { id: shortId }),
        `${BG_CALLBACK_PREFIX}restart:${task.id}:${safePage}`,
      )
      .text(
        t("bg.tasks.button.delete", { id: shortId }),
        `${BG_CALLBACK_PREFIX}delete:${task.id}:${safePage}`,
      )
      .row();
  }

  if (safePage > 0) {
    keyboard.text(t("bg.tasks.button.prev"), `${BG_CALLBACK_PREFIX}page:${safePage - 1}`);
  }
  if (safePage < maxPage) {
    keyboard.text(t("bg.tasks.button.next"), `${BG_CALLBACK_PREFIX}page:${safePage + 1}`);
  }
  if (safePage > 0 || safePage < maxPage) {
    keyboard.row();
  }

  keyboard.text(t("bg.menu.button.back"), `${BG_CALLBACK_PREFIX}back`);
  return keyboard;
}

async function safeEditBgMessage(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  try {
    const message = ctx.callbackQuery?.message;
    if (!message) {
      return;
    }
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (error) {
    logger.debug("[BG] Failed to edit message", error);
  }
}

function runBgDispatch(task: BgTask): void {
  safeBackgroundTask({
    taskName: `bg.dispatch.enqueue.${task.id}`,
    task: async () => {
      await enqueueBgDispatchRequest({ taskId: task.id });
    },
    onError: async () => {
      await applyBgNotify({
        taskId: task.id,
        token: task.token,
        status: "failed",
        summary: t("bg.create.failed"),
      });
    },
  });
}

export async function handleBgCommand(ctx: Context): Promise<void> {
  const message = await ctx.reply(t("bg.menu.title"), { reply_markup: buildMainMenuKeyboard() });
  startBgInteraction(ctx, "main", message.message_id);
}

export async function handleBgCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(BG_CALLBACK_PREFIX)) {
    return false;
  }
  const active = getActiveBgState();
  if (!active) {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }
  const { metadata } = active;
  const action = data.slice(BG_CALLBACK_PREFIX.length);
  const scope = getScope(ctx);

  const shouldRefreshTasks =
    action === "list" ||
    action.startsWith("page:") ||
    action.startsWith("stop:") ||
    action.startsWith("restart:") ||
    action.startsWith("delete:");
  if (shouldRefreshTasks) {
    await refreshBgTasksCache();
  }

  if (action === "cancel") {
    await removeBgMenuMessage(ctx, metadata);
    clearBgInteraction();
    await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
    return true;
  }

  if (action === "back") {
    transitionBgInteraction("main", metadata);
    await safeEditBgMessage(ctx, t("bg.menu.title"), buildMainMenuKeyboard());
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "new") {
    transitionBgInteraction("await_prompt", metadata);
    await safeEditBgMessage(ctx, t("bg.prompt.ask"), buildMainMenuKeyboard());
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "list") {
    if (scope.chatId === null) {
      await ctx.answerCallbackQuery({ text: t("bg.list.empty"), show_alert: true }).catch(() => {});
      return true;
    }
    transitionBgInteraction("main", metadata);
    await safeEditBgMessage(
      ctx,
      formatTaskListMessage(scope.chatId, scope.threadId, 0),
      buildTasksKeyboard(scope.chatId, scope.threadId, 0),
    );
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action.startsWith("page:")) {
    const page = Number.parseInt(action.slice("page:".length), 10);
    if (scope.chatId === null) {
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }
    await safeEditBgMessage(
      ctx,
      formatTaskListMessage(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
      buildTasksKeyboard(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
    );
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action.startsWith("post:")) {
    const choice = action.slice("post:".length) as BgPostActionType;
    const draft = metadata.draft ?? {};
    if (choice === "custom") {
      transitionBgInteraction("await_post_action_custom", {
        ...metadata,
        draft: {
          ...draft,
          postActionType: "custom",
        },
      });
      await safeEditBgMessage(ctx, t("bg.post.custom_prompt"), buildPostActionKeyboard());
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }
    await ctx.answerCallbackQuery().catch(() => {});
    await finalizeBgTaskCreation(
      ctx,
      { ...draft, postActionType: choice },
      metadata,
    );
    return true;
  }

  if (action.startsWith("stop:")) {
    const raw = action.slice("stop:".length);
    const [taskId, pageRaw] = raw.split(":");
    const page = Number.parseInt(pageRaw ?? "0", 10);
    const target = findBgTask(taskId);
    if (!target) {
      await ctx
        .answerCallbackQuery({ text: t("bg.tasks.not_found"), show_alert: true })
        .catch(() => {});
      return true;
    }
    if (isTerminalTask(target)) {
      await ctx
        .answerCallbackQuery({ text: t("bg.tasks.stop_not_running"), show_alert: true })
        .catch(() => {});
      return true;
    }
    await cancelBgTask(taskId, t("bg.tasks.cancelled"));
    if (scope.chatId !== null) {
      await safeEditBgMessage(
        ctx,
        formatTaskListMessage(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
        buildTasksKeyboard(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
      );
    }
    await ctx.answerCallbackQuery({ text: t("bg.tasks.stopped_callback") }).catch(() => {});
    return true;
  }

  if (action.startsWith("restart:")) {
    const raw = action.slice("restart:".length);
    const [taskId, pageRaw] = raw.split(":");
    const page = Number.parseInt(pageRaw ?? "0", 10);
    const target = findBgTask(taskId);
    if (!target) {
      await ctx
        .answerCallbackQuery({ text: t("bg.tasks.not_found"), show_alert: true })
        .catch(() => {});
      return true;
    }
    if (!isTerminalTask(target)) {
      await ctx
        .answerCallbackQuery({ text: t("bg.tasks.restart_only_stopped"), show_alert: true })
        .catch(() => {});
      return true;
    }
    const currentAgent = getStoredAgent(scope.threadId, scope.chatId);
    if (currentAgent === "plan") {
      await ctx
        .answerCallbackQuery({ text: t("bg.create.plan_mode_blocked"), show_alert: true })
        .catch(() => {});
      return true;
    }

    const created = await createBgTask({
      title: target.title,
      prompt: target.prompt,
      scope: target.scope,
      postAction: target.postAction,
    });

    runBgDispatch(created);

    if (scope.chatId !== null) {
      await safeEditBgMessage(
        ctx,
        formatTaskListMessage(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
        buildTasksKeyboard(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
      );
    }
    await ctx.answerCallbackQuery({ text: t("bg.tasks.restarted_callback") }).catch(() => {});
    return true;
  }

  if (action.startsWith("delete:")) {
    const raw = action.slice("delete:".length);
    const [taskId, pageRaw] = raw.split(":");
    const page = Number.parseInt(pageRaw ?? "0", 10);
    const target = findBgTask(taskId);
    if (!target) {
      await ctx
        .answerCallbackQuery({ text: t("bg.tasks.not_found"), show_alert: true })
        .catch(() => {});
      return true;
    }
    if (!isTerminalTask(target)) {
      await ctx
        .answerCallbackQuery({ text: t("bg.tasks.delete_only_completed"), show_alert: true })
        .catch(() => {});
      return true;
    }
    await deleteBgTask(taskId);
    if (scope.chatId !== null) {
      await safeEditBgMessage(
        ctx,
        formatTaskListMessage(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
        buildTasksKeyboard(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
      );
    }
    await ctx.answerCallbackQuery({ text: t("bg.tasks.deleted_callback") }).catch(() => {});
    return true;
  }

  await ctx.answerCallbackQuery({ text: t("callback.unknown_command") }).catch(() => {});
  return true;
}

export async function handleBgTextInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) {
    return false;
  }
  const active = getActiveBgState();
  if (!active) {
    return false;
  }
  const { metadata } = active;

  if (metadata.step === "await_prompt") {
    // Edit the existing bg menu message in-place instead of sending a new one.
    // This avoids leaving a stale keyboard on the original message.
    if (typeof metadata.messageId === "number" && metadata.interactionChatId !== null) {
      await ctx.api
        .editMessageText(metadata.interactionChatId, metadata.messageId, t("bg.post.choose"), {
          reply_markup: buildPostActionKeyboard(),
        })
        .catch(() => {});
    }
    transitionBgInteraction("await_post_action_callback", {
      ...metadata,
      // messageId unchanged — still points to the same (now edited) message
      draft: {
        ...(metadata.draft ?? {}),
        prompt: text,
      },
    });
    return true;
  }

  if (metadata.step !== "await_post_action_custom") {
    return false;
  }

  await finalizeBgTaskCreation(
    ctx,
    { ...(metadata.draft ?? {}), postActionType: "custom", postActionPrompt: text },
    metadata,
  );
  return true;
}

async function finalizeBgTaskCreation(
  ctx: Context,
  draft: BgDraft,
  metadata: BgInteractionMetadata,
): Promise<void> {
  const scope = getScope(ctx);
  const session = ensureSessionForCreate(ctx);
  const mainPrompt = draft.prompt?.trim();

  if (!session || scope.chatId === null || !mainPrompt) {
    clearBgInteraction();
    await removeBgMenuMessage(ctx, metadata);
    await ctx.reply(t("bg.create.no_session"));
    return;
  }

  const currentAgent = getStoredAgent(scope.threadId, scope.chatId);
  if (currentAgent === "plan") {
    clearBgInteraction();
    await removeBgMenuMessage(ctx, metadata);
    await ctx.reply(t("bg.create.plan_mode_blocked"));
    return;
  }

  const postActionType = draft.postActionType ?? "none";
  const postAction: BgPostAction =
    postActionType === "custom" && draft.postActionPrompt
      ? { type: "custom", prompt: draft.postActionPrompt }
      : postActionType === "summarize"
        ? { type: "summarize" }
        : { type: "none" };

  try {
    const created = await createBgTask({
      title: mainPrompt,
      prompt: mainPrompt,
      scope: {
        chatId: scope.chatId,
        threadId: scope.threadId,
        sessionId: session.id,
        directory: session.directory,
      },
      postAction,
    });

    clearBgInteraction();
    await removeBgMenuMessage(ctx, metadata);
    await ctx.reply(t("bg.create.queued"), { reply_to_message_id: ctx.message?.message_id });

    runBgDispatch(created);
  } catch (error) {
    logger.error("[BG] Failed to create background task", error);
    clearBgInteraction();
    await removeBgMenuMessage(ctx, metadata);
    await ctx.reply(t("bg.create.failed"));
  }
}
