import {
  getScheduledTasks as getStoredScheduledTasks,
  setScheduledTasks as setStoredScheduledTasks,
} from "../settings/manager.js";
import type {
  CreateScheduledTaskInput,
  ScheduleRule,
  ScheduledTask,
  WeeklyDay,
} from "./types.js";

const SCHEDULE_RETRY_DELAY_MS = 60_000;

function getNow(): Date {
  return new Date();
}

function parseTimeString(time: string): { hour: number; minute: number } | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate();
}

function buildLocalDate(year: number, monthOneBased: number, day: number, hour: number, minute: number): Date {
  return new Date(year, monthOneBased - 1, day, hour, minute, 0, 0);
}

function computeNextDaily(time: string, from: Date): Date | null {
  const parsed = parseTimeString(time);
  if (!parsed) {
    return null;
  }

  const candidate = new Date(from);
  candidate.setHours(parsed.hour, parsed.minute, 0, 0);

  if (candidate.getTime() > from.getTime()) {
    return candidate;
  }

  candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function computeNextWeekly(dayOfWeek: WeeklyDay, time: string, from: Date): Date | null {
  const parsed = parseTimeString(time);
  if (!parsed) {
    return null;
  }

  const base = new Date(from);
  base.setHours(parsed.hour, parsed.minute, 0, 0);
  const currentDay = base.getDay() as WeeklyDay;
  let deltaDays = dayOfWeek - currentDay;

  if (deltaDays < 0) {
    deltaDays += 7;
  }

  const candidate = new Date(base);
  candidate.setDate(base.getDate() + deltaDays);

  if (candidate.getTime() > from.getTime()) {
    return candidate;
  }

  candidate.setDate(candidate.getDate() + 7);
  return candidate;
}

function computeNextMonthly(dayOfMonth: number, time: string, from: Date): Date | null {
  const parsed = parseTimeString(time);
  if (!parsed || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }

  let year = from.getFullYear();
  let month = from.getMonth() + 1;

  for (let i = 0; i < 24; i += 1) {
    const maxDay = daysInMonth(year, month);
    if (dayOfMonth <= maxDay) {
      const candidate = buildLocalDate(year, month, dayOfMonth, parsed.hour, parsed.minute);
      if (candidate.getTime() > from.getTime()) {
        return candidate;
      }
    }

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return null;
}

function computeNextYearly(month: number, day: number, time: string, from: Date): Date | null {
  const parsed = parseTimeString(time);
  if (!parsed || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  let year = from.getFullYear();
  for (let i = 0; i < 20; i += 1) {
    const maxDay = daysInMonth(year, month);
    if (day <= maxDay) {
      const candidate = buildLocalDate(year, month, day, parsed.hour, parsed.minute);
      if (candidate.getTime() > from.getTime()) {
        return candidate;
      }
    }

    year += 1;
  }

  return null;
}

export function getMachineTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function computeNextRunAt(rule: ScheduleRule, from: Date): Date | null {
  if (rule.type === "once") {
    const runAt = new Date(rule.runAt);
    if (Number.isNaN(runAt.getTime())) {
      return null;
    }

    if (runAt.getTime() <= from.getTime()) {
      return null;
    }

    return runAt;
  }

  if (rule.type === "recurring_daily") {
    return computeNextDaily(rule.time, from);
  }

  if (rule.type === "recurring_weekly") {
    return computeNextWeekly(rule.dayOfWeek, rule.time, from);
  }

  if (rule.type === "recurring_monthly") {
    return computeNextMonthly(rule.dayOfMonth, rule.time, from);
  }

  return computeNextYearly(rule.month, rule.day, rule.time, from);
}

function makeTaskId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function saveTasks(tasks: ScheduledTask[]): Promise<void> {
  await setStoredScheduledTasks(tasks);
}

function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((a, b) => {
    const aTs = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
    const bTs = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
    return aTs - bTs;
  });
}

export function listScheduledTasks(): ScheduledTask[] {
  return sortTasks(getStoredScheduledTasks());
}

export function listScheduledTasksByScope(chatId: number, threadId: number | null): ScheduledTask[] {
  return sortTasks(
    getStoredScheduledTasks().filter((task) => task.scope.chatId === chatId && task.scope.threadId === threadId),
  );
}

export async function createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTask> {
  const now = getNow();
  const nextRunAt = computeNextRunAt(input.rule, now);
  const timestamp = now.toISOString();

  const task: ScheduledTask = {
    id: makeTaskId(),
    prompt: input.prompt.trim(),
    scope: input.scope,
    rule: input.rule,
    status: nextRunAt ? "active" : "completed",
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    runCount: 0,
  };

  const current = getStoredScheduledTasks();
  await saveTasks([...current, task]);
  return task;
}

export async function deleteScheduledTask(taskId: string): Promise<boolean> {
  const tasks = getStoredScheduledTasks();
  const filtered = tasks.filter((task) => task.id !== taskId);
  if (filtered.length === tasks.length) {
    return false;
  }

  await saveTasks(filtered);
  return true;
}

export async function toggleScheduledTaskPause(taskId: string): Promise<ScheduledTask | null> {
  const tasks = getStoredScheduledTasks();
  const now = getNow();
  let changed: ScheduledTask | null = null;

  const updated = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    if (task.status === "completed") {
      changed = task;
      return task;
    }

    if (task.status === "paused") {
      const nextRunAt = computeNextRunAt(task.rule, now);
      const resumed: ScheduledTask = {
        ...task,
        status: nextRunAt ? "active" : "completed",
        nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
        updatedAt: now.toISOString(),
      };
      changed = resumed;
      return resumed;
    }

    const paused: ScheduledTask = {
      ...task,
      status: "paused",
      updatedAt: now.toISOString(),
    };
    changed = paused;
    return paused;
  });

  if (!changed) {
    return null;
  }

  await saveTasks(updated);
  return changed;
}

export function getDueScheduledTasks(referenceTime: Date = getNow()): ScheduledTask[] {
  return getStoredScheduledTasks().filter((task) => {
    if (task.status !== "active" || !task.nextRunAt) {
      return false;
    }

    const dueAt = new Date(task.nextRunAt);
    if (Number.isNaN(dueAt.getTime())) {
      return false;
    }

    return dueAt.getTime() <= referenceTime.getTime();
  });
}

export async function markScheduledTaskRunSuccess(taskId: string, finishedAt: Date = getNow()): Promise<void> {
  const finishedAtIso = finishedAt.toISOString();
  const updated = getStoredScheduledTasks().map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    if (task.rule.type === "once") {
      return {
        ...task,
        status: "completed" as const,
        nextRunAt: null,
        lastRunAt: finishedAtIso,
        lastError: undefined,
        runCount: task.runCount + 1,
        updatedAt: finishedAtIso,
      };
    }

    const next = computeNextRunAt(task.rule, new Date(finishedAt.getTime() + 1000));
    return {
      ...task,
      status: next ? ("active" as const) : ("completed" as const),
      nextRunAt: next ? next.toISOString() : null,
      lastRunAt: finishedAtIso,
      lastError: undefined,
      runCount: task.runCount + 1,
      updatedAt: finishedAtIso,
    };
  });

  await saveTasks(updated);
}

export async function markScheduledTaskRunFailure(
  taskId: string,
  errorMessage: string,
  failedAt: Date = getNow(),
): Promise<void> {
  const failedAtIso = failedAt.toISOString();
  const retryAt = new Date(failedAt.getTime() + SCHEDULE_RETRY_DELAY_MS).toISOString();

  const updated = getStoredScheduledTasks().map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    if (task.status !== "active") {
      return task;
    }

    return {
      ...task,
      nextRunAt: retryAt,
      lastError: errorMessage,
      updatedAt: failedAtIso,
    };
  });

  await saveTasks(updated);
}
