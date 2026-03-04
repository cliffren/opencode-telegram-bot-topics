import { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import {
  createScheduledTask,
  deleteScheduledTask,
  getMachineTimezone,
  listScheduledTasksByScope,
  toggleScheduledTaskPause,
} from "../../schedule/manager.js";
import type { ScheduleRule, WeeklyDay } from "../../schedule/types.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentSessionByThread } from "./prompt.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const SCHEDULE_CALLBACK_PREFIX = "schedule:";
const SCHEDULE_ALLOWED_COMMANDS = ["/help", "/status", "/stop", "/schedule"];
const SCHEDULE_PAGE_SIZE = 5;

type ScheduleCreateStep =
  | "main"
  | "await_once_datetime"
  | "await_after"
  | "await_daily_time"
  | "await_weekly_time"
  | "await_monthly"
  | "await_yearly"
  | "await_prompt";

interface ScheduleDraft {
  rule?: ScheduleRule;
}

interface ScheduleInteractionMetadata {
  flow: "schedule";
  step: ScheduleCreateStep;
  messageId?: number;
  interactionChatId: number | null;
  interactionThreadId: number | null;
  draft?: ScheduleDraft;
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

function getActiveScheduleState(): { state: InteractionState; metadata: ScheduleInteractionMetadata } | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom") {
    return null;
  }

  const metadata = state.metadata as Partial<ScheduleInteractionMetadata>;
  if (metadata.flow !== "schedule" || typeof metadata.step !== "string") {
    return null;
  }

  if (
    metadata.step !== "main" &&
    metadata.step !== "await_once_datetime" &&
    metadata.step !== "await_after" &&
    metadata.step !== "await_daily_time" &&
    metadata.step !== "await_weekly_time" &&
    metadata.step !== "await_monthly" &&
    metadata.step !== "await_yearly" &&
    metadata.step !== "await_prompt"
  ) {
    return null;
  }

  return {
    state,
    metadata: {
      flow: "schedule",
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

function startScheduleInteraction(
  ctx: Context,
  step: ScheduleCreateStep,
  messageId?: number,
  draft?: ScheduleDraft,
): void {
  const scope = getScope(ctx);
  interactionManager.start({
    kind: "custom",
    expectedInput: step === "main" ? "callback" : "mixed",
    allowedCommands: SCHEDULE_ALLOWED_COMMANDS,
    metadata: {
      flow: "schedule",
      step,
      messageId,
      interactionChatId: scope.chatId,
      interactionThreadId: scope.threadId,
      draft,
    },
  });
}

function transitionScheduleInteraction(
  step: ScheduleCreateStep,
  metadata: ScheduleInteractionMetadata,
): void {
  interactionManager.transition({
    expectedInput: step === "main" ? "callback" : "mixed",
    allowedCommands: SCHEDULE_ALLOWED_COMMANDS,
    metadata: {
      ...metadata,
      step,
    },
  });
}

function clearScheduleInteraction(): void {
  const active = getActiveScheduleState();
  if (!active) {
    return;
  }

  interactionManager.clear("schedule_finished");
}

async function removeScheduleMenuMessage(
  ctx: Context,
  metadata: ScheduleInteractionMetadata,
): Promise<void> {
  if (typeof metadata.messageId !== "number") {
    return;
  }

  const chatId = ctx.chat?.id ?? metadata.interactionChatId;
  if (chatId === null) {
    return;
  }

  await ctx.api.deleteMessage(chatId, metadata.messageId).catch(() => {});
}

function ensureSessionForCreate(ctx: Context): { id: string; title: string; directory: string } | null {
  const scope = getScope(ctx);
  const scopedSession = getCurrentSessionByThread(scope.threadId, scope.chatId);
  const fallbackSession = getCurrentSession();
  return scopedSession ?? fallbackSession;
}

function formatTaskTime(isoTime: string | null): string {
  if (!isoTime) {
    return "-";
  }

  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function formatShortTaskId(taskId: string): string {
  if (taskId.length <= 6) {
    return taskId;
  }

  return taskId.slice(-6);
}

function buildMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("schedule.menu.button.add_once"), `${SCHEDULE_CALLBACK_PREFIX}add_once`)
    .row()
    .text(t("schedule.menu.button.add_after"), `${SCHEDULE_CALLBACK_PREFIX}add_after`)
    .row()
    .text(t("schedule.menu.button.add_daily"), `${SCHEDULE_CALLBACK_PREFIX}add_daily`)
    .text(t("schedule.menu.button.add_weekly"), `${SCHEDULE_CALLBACK_PREFIX}add_weekly`)
    .row()
    .text(t("schedule.menu.button.add_monthly"), `${SCHEDULE_CALLBACK_PREFIX}add_monthly`)
    .text(t("schedule.menu.button.add_yearly"), `${SCHEDULE_CALLBACK_PREFIX}add_yearly`)
    .row()
    .text(t("schedule.menu.button.list"), `${SCHEDULE_CALLBACK_PREFIX}list`)
    .row()
    .text(t("inline.button.cancel"), `${SCHEDULE_CALLBACK_PREFIX}cancel`);
}

function buildWeekdayKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("schedule.weekday.mon"), `${SCHEDULE_CALLBACK_PREFIX}weekday:1`)
    .text(t("schedule.weekday.tue"), `${SCHEDULE_CALLBACK_PREFIX}weekday:2`)
    .text(t("schedule.weekday.wed"), `${SCHEDULE_CALLBACK_PREFIX}weekday:3`)
    .row()
    .text(t("schedule.weekday.thu"), `${SCHEDULE_CALLBACK_PREFIX}weekday:4`)
    .text(t("schedule.weekday.fri"), `${SCHEDULE_CALLBACK_PREFIX}weekday:5`)
    .text(t("schedule.weekday.sat"), `${SCHEDULE_CALLBACK_PREFIX}weekday:6`)
    .row()
    .text(t("schedule.weekday.sun"), `${SCHEDULE_CALLBACK_PREFIX}weekday:0`)
    .row()
    .text(t("schedule.menu.button.back"), `${SCHEDULE_CALLBACK_PREFIX}back`)
    .text(t("inline.button.cancel"), `${SCHEDULE_CALLBACK_PREFIX}cancel`);
}

function buildTasksKeyboard(chatId: number, threadId: number | null, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const tasks = listScheduledTasksByScope(chatId, threadId);
  const maxPage = Math.max(0, Math.ceil(tasks.length / SCHEDULE_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * SCHEDULE_PAGE_SIZE;
  const pageItems = tasks.slice(start, start + SCHEDULE_PAGE_SIZE);

  for (const task of pageItems) {
    const shortId = formatShortTaskId(task.id);
    const toggleLabel =
      task.status === "paused"
        ? t("schedule.tasks.button.resume", { id: shortId })
        : t("schedule.tasks.button.pause", { id: shortId });
    keyboard
      .text(toggleLabel, `${SCHEDULE_CALLBACK_PREFIX}toggle:${task.id}:${safePage}`)
      .text(
        t("schedule.tasks.button.delete", { id: shortId }),
        `${SCHEDULE_CALLBACK_PREFIX}delete:${task.id}:${safePage}`,
      )
      .row();
  }

  if (maxPage > 0) {
    if (safePage > 0) {
      keyboard.text(t("schedule.tasks.button.prev"), `${SCHEDULE_CALLBACK_PREFIX}page:${safePage - 1}`);
    }

    keyboard.text(
      t("schedule.tasks.button.page", { current: String(safePage + 1), total: String(maxPage + 1) }),
      `${SCHEDULE_CALLBACK_PREFIX}noop`,
    );

    if (safePage < maxPage) {
      keyboard.text(t("schedule.tasks.button.next"), `${SCHEDULE_CALLBACK_PREFIX}page:${safePage + 1}`);
    }
    keyboard.row();
  }

  keyboard
    .text(t("schedule.menu.button.back"), `${SCHEDULE_CALLBACK_PREFIX}back`)
    .text(t("inline.button.cancel"), `${SCHEDULE_CALLBACK_PREFIX}cancel`);

  return keyboard;
}

function parseOnceDatetime(input: string): Date | null {
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

function parseDelayInput(input: string): Date | null {
  const match = input.trim().match(/^(\d+)\s*([mMhH])$/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  if (Number.isNaN(value) || value <= 0) {
    return null;
  }

  const unit = match[2].toLowerCase();
  const delayMs = unit === "h" ? value * 60 * 60 * 1000 : value * 60 * 1000;
  return new Date(Date.now() + delayMs);
}

function parseTimeOnly(input: string): string | null {
  const match = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function parseMonthlyInput(input: string): { dayOfMonth: number; time: string } | null {
  const match = input.trim().match(/^(\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (!match) {
    return null;
  }

  const dayOfMonth = Number.parseInt(match[1], 10);
  if (dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }

  const time = parseTimeOnly(match[2]);
  if (!time) {
    return null;
  }

  return { dayOfMonth, time };
}

function parseYearlyInput(input: string): { month: number; day: number; time: string } | null {
  const match = input.trim().match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const time = parseTimeOnly(match[3]);
  if (!time) {
    return null;
  }

  return { month, day, time };
}

function describeRule(rule: ScheduleRule): string {
  if (rule.type === "once") {
    return t("schedule.rule.once", { value: formatTaskTime(rule.runAt) });
  }

  if (rule.type === "recurring_daily") {
    return t("schedule.rule.daily", { value: rule.time });
  }

  if (rule.type === "recurring_weekly") {
    const shortDayKeyByIndex: Record<WeeklyDay, "schedule.weekday.short.0" | "schedule.weekday.short.1" | "schedule.weekday.short.2" | "schedule.weekday.short.3" | "schedule.weekday.short.4" | "schedule.weekday.short.5" | "schedule.weekday.short.6"> = {
      0: "schedule.weekday.short.0",
      1: "schedule.weekday.short.1",
      2: "schedule.weekday.short.2",
      3: "schedule.weekday.short.3",
      4: "schedule.weekday.short.4",
      5: "schedule.weekday.short.5",
      6: "schedule.weekday.short.6",
    };
    return t("schedule.rule.weekly", {
      day: t(shortDayKeyByIndex[rule.dayOfWeek]),
      time: rule.time,
    });
  }

  if (rule.type === "recurring_monthly") {
    return t("schedule.rule.monthly", { day: String(rule.dayOfMonth), time: rule.time });
  }

  return t("schedule.rule.yearly", {
    month: String(rule.month).padStart(2, "0"),
    day: String(rule.day).padStart(2, "0"),
    time: rule.time,
  });
}

function formatTaskListPageMessage(chatId: number, threadId: number | null, page: number): string {
  const tasks = listScheduledTasksByScope(chatId, threadId);
  if (tasks.length === 0) {
    return t("schedule.tasks.empty");
  }

  const maxPage = Math.max(0, Math.ceil(tasks.length / SCHEDULE_PAGE_SIZE) - 1);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * SCHEDULE_PAGE_SIZE;
  const pageItems = tasks.slice(start, start + SCHEDULE_PAGE_SIZE);

  const lines: string[] = [
    t("schedule.tasks.header", { tz: getMachineTimezone() }),
    t("schedule.tasks.page", { current: String(safePage + 1), total: String(maxPage + 1) }),
    "",
  ];

  for (const task of pageItems) {
    const shortId = formatShortTaskId(task.id);
    lines.push(
      t("schedule.tasks.item", {
        id: shortId,
        status: task.status,
        next: formatTaskTime(task.nextRunAt),
        rule: describeRule(task.rule),
      }),
    );
    lines.push(`  ${task.prompt}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

async function showMainMenu(ctx: Context): Promise<void> {
  const timezone = getMachineTimezone();
  const message = await ctx.reply(t("schedule.menu.title", { tz: timezone }), {
    reply_markup: buildMainMenuKeyboard(),
  });
  startScheduleInteraction(ctx, "main", message.message_id);
}

async function beginPromptStep(ctx: Context, metadata: ScheduleInteractionMetadata): Promise<void> {
  transitionScheduleInteraction("await_prompt", metadata);
  await ctx.reply(t("schedule.input.prompt"));
}

export async function scheduleCommand(ctx: Context): Promise<void> {
  clearScheduleInteraction();
  await showMainMenu(ctx);
}

export async function handleScheduleCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(SCHEDULE_CALLBACK_PREFIX)) {
    return false;
  }

  const active = getActiveScheduleState();
  if (!active) {
    await ctx.answerCallbackQuery({ text: t("schedule.inactive_callback"), show_alert: true }).catch(() => {});
    return true;
  }

  const action = data.slice(SCHEDULE_CALLBACK_PREFIX.length);
  const metadata = active.metadata;
  const scope = getScope(ctx);

  if (action === "cancel") {
    clearScheduleInteraction();
    await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  if (action === "back") {
    transitionScheduleInteraction("main", { ...metadata, draft: undefined });
    await ctx.editMessageText(t("schedule.menu.title", { tz: getMachineTimezone() }), {
      reply_markup: buildMainMenuKeyboard(),
    });
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "list") {
    if (scope.chatId === null) {
      await ctx.answerCallbackQuery({ text: t("error.generic") }).catch(() => {});
      return true;
    }

    const text = formatTaskListPageMessage(scope.chatId, scope.threadId, 0);
    await ctx.editMessageText(text, {
      reply_markup: buildTasksKeyboard(scope.chatId, scope.threadId, 0),
    });
    transitionScheduleInteraction("main", metadata);
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action.startsWith("page:")) {
    if (scope.chatId === null) {
      await ctx.answerCallbackQuery({ text: t("error.generic") }).catch(() => {});
      return true;
    }

    const rawPage = action.slice("page:".length);
    const page = Number.parseInt(rawPage, 10);
    if (Number.isNaN(page)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return true;
    }

    await ctx.editMessageText(formatTaskListPageMessage(scope.chatId, scope.threadId, page), {
      reply_markup: buildTasksKeyboard(scope.chatId, scope.threadId, page),
    });
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "noop") {
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action.startsWith("toggle:")) {
    const raw = action.slice("toggle:".length);
    const [taskId, pageRaw] = raw.split(":");
    const page = Number.parseInt(pageRaw ?? "0", 10);
    const changed = await toggleScheduledTaskPause(taskId);
    if (!changed) {
      await ctx.answerCallbackQuery({ text: t("schedule.tasks.not_found"), show_alert: true }).catch(() => {});
      return true;
    }

    if (scope.chatId !== null) {
      await ctx.editMessageText(formatTaskListPageMessage(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page), {
        reply_markup: buildTasksKeyboard(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
      });
    }
    await ctx.answerCallbackQuery({ text: t("schedule.tasks.updated_callback") }).catch(() => {});
    return true;
  }

  if (action.startsWith("delete:")) {
    const raw = action.slice("delete:".length);
    const [taskId, pageRaw] = raw.split(":");
    const page = Number.parseInt(pageRaw ?? "0", 10);
    const deleted = await deleteScheduledTask(taskId);
    if (!deleted) {
      await ctx.answerCallbackQuery({ text: t("schedule.tasks.not_found"), show_alert: true }).catch(() => {});
      return true;
    }

    if (scope.chatId !== null) {
      await ctx.editMessageText(formatTaskListPageMessage(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page), {
        reply_markup: buildTasksKeyboard(scope.chatId, scope.threadId, Number.isNaN(page) ? 0 : page),
      });
    }
    await ctx.answerCallbackQuery({ text: t("schedule.tasks.deleted_callback") }).catch(() => {});
    return true;
  }

  if (action === "add_once") {
    transitionScheduleInteraction("await_once_datetime", { ...metadata, draft: {} });
    await ctx.reply(t("schedule.input.once"));
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "add_after") {
    transitionScheduleInteraction("await_after", { ...metadata, draft: {} });
    await ctx.reply(t("schedule.input.after"));
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "add_daily") {
    transitionScheduleInteraction("await_daily_time", { ...metadata, draft: {} });
    await ctx.reply(t("schedule.input.daily"));
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "add_weekly") {
    transitionScheduleInteraction("main", { ...metadata, draft: {} });
    await ctx.reply(t("schedule.input.weekly_day"), { reply_markup: buildWeekdayKeyboard() });
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action.startsWith("weekday:")) {
    const raw = action.slice("weekday:".length);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 6) {
      await ctx.answerCallbackQuery({ text: t("schedule.invalid.weekday") }).catch(() => {});
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        type: "recurring_weekly",
        dayOfWeek: parsed as WeeklyDay,
        time: "00:00",
      },
    };

    transitionScheduleInteraction("await_weekly_time", { ...metadata, draft });
    await ctx.reply(t("schedule.input.weekly_time"));
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "add_monthly") {
    transitionScheduleInteraction("await_monthly", { ...metadata, draft: {} });
    await ctx.reply(t("schedule.input.monthly"));
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  if (action === "add_yearly") {
    transitionScheduleInteraction("await_yearly", { ...metadata, draft: {} });
    await ctx.reply(t("schedule.input.yearly"));
    await ctx.answerCallbackQuery().catch(() => {});
    return true;
  }

  await ctx.answerCallbackQuery({ text: t("callback.unknown_command") }).catch(() => {});
  return true;
}

export async function handleScheduleTextInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith("/")) {
    return false;
  }

  const active = getActiveScheduleState();
  if (!active) {
    return false;
  }

  const { metadata } = active;
  if (metadata.step === "main") {
    return false;
  }

  if (metadata.step === "await_once_datetime") {
    const runAt = parseOnceDatetime(text);
    if (!runAt || runAt.getTime() <= Date.now()) {
      await ctx.reply(t("schedule.invalid.once"));
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        type: "once",
        runAt: runAt.toISOString(),
      },
    };
    await beginPromptStep(ctx, { ...metadata, draft });
    return true;
  }

  if (metadata.step === "await_after") {
    const runAt = parseDelayInput(text);
    if (!runAt) {
      await ctx.reply(t("schedule.invalid.after"));
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        type: "once",
        runAt: runAt.toISOString(),
      },
    };
    await beginPromptStep(ctx, { ...metadata, draft });
    return true;
  }

  if (metadata.step === "await_daily_time") {
    const time = parseTimeOnly(text);
    if (!time) {
      await ctx.reply(t("schedule.invalid.time"));
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        type: "recurring_daily",
        time,
      },
    };
    await beginPromptStep(ctx, { ...metadata, draft });
    return true;
  }

  if (metadata.step === "await_weekly_time") {
    const time = parseTimeOnly(text);
    const existingRule = metadata.draft?.rule;
    if (!time || !existingRule || existingRule.type !== "recurring_weekly") {
      await ctx.reply(t("schedule.invalid.time"));
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        ...existingRule,
        time,
      },
    };
    await beginPromptStep(ctx, { ...metadata, draft });
    return true;
  }

  if (metadata.step === "await_monthly") {
    const parsed = parseMonthlyInput(text);
    if (!parsed) {
      await ctx.reply(t("schedule.invalid.monthly"));
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        type: "recurring_monthly",
        dayOfMonth: parsed.dayOfMonth,
        time: parsed.time,
      },
    };
    await beginPromptStep(ctx, { ...metadata, draft });
    return true;
  }

  if (metadata.step === "await_yearly") {
    const parsed = parseYearlyInput(text);
    if (!parsed) {
      await ctx.reply(t("schedule.invalid.yearly"));
      return true;
    }

    const draft: ScheduleDraft = {
      rule: {
        type: "recurring_yearly",
        month: parsed.month,
        day: parsed.day,
        time: parsed.time,
      },
    };
    await beginPromptStep(ctx, { ...metadata, draft });
    return true;
  }

  if (metadata.step === "await_prompt") {
    const rule = metadata.draft?.rule;
    const session = ensureSessionForCreate(ctx);
    const scope = getScope(ctx);

    if (!rule) {
      await ctx.reply(t("schedule.invalid.generic"));
      clearScheduleInteraction();
      return true;
    }

    if (!session || scope.chatId === null) {
      await ctx.reply(t("schedule.create.no_session"));
      clearScheduleInteraction();
      return true;
    }

    try {
      const created = await createScheduledTask({
        prompt: text,
        scope: {
          chatId: scope.chatId,
          threadId: scope.threadId,
          sessionId: session.id,
          sessionTitle: session.title,
          directory: session.directory,
        },
        rule,
      });

      await removeScheduleMenuMessage(ctx, metadata);
      clearScheduleInteraction();
      await ctx.reply(
        t("schedule.created", {
          id: formatShortTaskId(created.id),
          rule: describeRule(created.rule),
          next: formatTaskTime(created.nextRunAt),
          tz: getMachineTimezone(),
        }),
      );
    } catch (error) {
      logger.error("[Schedule] Failed to create task", error);
      await ctx.reply(t("schedule.create.failed"));
      clearScheduleInteraction();
    }

    return true;
  }

  return false;
}
