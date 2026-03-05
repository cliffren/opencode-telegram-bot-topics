import crypto from "node:crypto";
import {
  getBgTasks as getStoredBgTasks,
  loadSettings,
  setBgTasks as setStoredBgTasks,
} from "../settings/manager.js";
import type {
  BgNotifyInput,
  BgPostActionStatus,
  BgTask,
  BgTaskCreateInput,
  BgTaskStatus,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function getTasksHydrated(): BgTask[] {
  return getStoredBgTasks().map((task: BgTask) => ({ ...task }));
}

async function saveTasks(tasks: BgTask[]): Promise<void> {
  await setStoredBgTasks(tasks);
}

export async function refreshBgTasksCache(): Promise<void> {
  await loadSettings();
}

export function isTerminalTask(task: BgTask): boolean {
  return task.status === "succeeded" || task.status === "failed";
}

export function listBgTasksByScope(chatId: number, threadId: number | null): BgTask[] {
  return getTasksHydrated().filter(
    (task) => task.scope.chatId === chatId && task.scope.threadId === threadId,
  );
}

export function findBgTask(taskId: string): BgTask | null {
  return getTasksHydrated().find((task) => task.id === taskId) ?? null;
}

export async function createBgTask(input: BgTaskCreateInput): Promise<BgTask> {
  const timestamp = nowIso();
  const task: BgTask = {
    id: createId("bg"),
    token: createId("tkn"),
    title: input.title.trim() || input.prompt.trim(),
    prompt: input.prompt,
    scope: input.scope,
    status: "queued",
    postAction: input.postAction,
    postActionStatus: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const tasks = getTasksHydrated();
  tasks.unshift(task);
  await saveTasks(tasks);
  return task;
}

export async function deleteBgTask(taskId: string): Promise<void> {
  const tasks = getTasksHydrated().filter((task) => task.id !== taskId);
  await saveTasks(tasks);
}

export async function cancelBgTask(taskId: string, reason?: string): Promise<BgTask | null> {
  const tasks = getTasksHydrated();
  const timestamp = nowIso();
  let updatedTask: BgTask | null = null;
  const updated = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }
    if (task.pid) {
      try {
        process.kill(task.pid, "SIGTERM");
      } catch {}
    }
    const next: BgTask = {
      ...task,
      status: "failed",
      summary: reason ?? task.summary ?? "Cancelled by user",
      finishedAt: timestamp,
      updatedAt: timestamp,
    };
    updatedTask = next;
    return next;
  });
  await saveTasks(updated);
  return updatedTask;
}

function normalizeTaskTitle(incoming: string | undefined, fallback: string): string {
  const normalized = incoming?.trim();
  if (normalized) {
    return normalized;
  }
  return fallback.trim() || fallback;
}

export async function applyBgNotify(input: BgNotifyInput): Promise<{
  task: BgTask | null;
  accepted: boolean;
  code: "ok" | "not_found" | "invalid_token" | "already_settled";
}> {
  const tasks = getTasksHydrated();
  const existing = tasks.find((task) => task.id === input.taskId);
  if (!existing) {
    return { task: null, accepted: false, code: "not_found" };
  }
  if (existing.token !== input.token) {
    return { task: null, accepted: false, code: "invalid_token" };
  }
  if (isTerminalTask(existing)) {
    return { task: existing, accepted: false, code: "already_settled" };
  }

  const timestamp = nowIso();
  let changed: BgTask | null = null;
  const updated = tasks.map((task) => {
    if (task.id !== input.taskId) {
      return task;
    }

    if (input.status === "started") {
      const next: BgTask = {
        ...task,
        status: "running",
        title: normalizeTaskTitle(input.title, task.prompt),
        pid: input.pid ?? task.pid,
        logPath: input.logPath ?? task.logPath,
        startedAt: task.startedAt ?? timestamp,
        summary: input.summary ?? task.summary,
        updatedAt: timestamp,
      };
      changed = next;
      return next;
    }

    const terminalStatus: BgTaskStatus = input.status === "done" ? "succeeded" : "failed";
    const next: BgTask = {
      ...task,
      status: terminalStatus,
      title: normalizeTaskTitle(input.title, task.prompt),
      logPath: input.logPath ?? task.logPath,
      summary: input.summary ?? task.summary,
      finishedAt: timestamp,
      updatedAt: timestamp,
    };
    changed = next;
    return next;
  });

  if (!changed) {
    return { task: null, accepted: false, code: "not_found" };
  }

  await saveTasks(updated);
  return { task: changed, accepted: true, code: "ok" };
}

export async function markBgTaskNotificationSent(taskId: string): Promise<void> {
  const tasks = getTasksHydrated();
  const timestamp = nowIso();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }
    if (task.notificationSentAt) {
      return task;
    }
    return {
      ...task,
      notificationSentAt: timestamp,
      updatedAt: timestamp,
    };
  });
  await saveTasks(updated);
}

export async function markBgPostActionResult(
  taskId: string,
  status: BgPostActionStatus,
  error?: string,
): Promise<void> {
  const tasks = getTasksHydrated();
  const timestamp = nowIso();
  const updated = tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }
    return {
      ...task,
      postActionStatus: status,
      postActionSentAt: status === "sent" ? timestamp : task.postActionSentAt,
      postActionError: status === "failed" ? (error ?? "post_action_failed") : undefined,
      updatedAt: timestamp,
    };
  });
  await saveTasks(updated);
}

export async function reconcileBgTasksByPid(): Promise<number> {
  const tasks = getTasksHydrated();
  const timestamp = nowIso();
  let changedCount = 0;
  const updated = tasks.map((task) => {
    if (task.status !== "running" || typeof task.pid !== "number") {
      return task;
    }
    try {
      process.kill(task.pid, 0);
      return task;
    } catch {
      changedCount += 1;
      return {
        ...task,
        status: "failed" as const,
        summary: task.summary ?? "Background process ended without callback",
        finishedAt: task.finishedAt ?? timestamp,
        updatedAt: timestamp,
      };
    }
  });
  if (changedCount > 0) {
    await saveTasks(updated);
  }
  return changedCount;
}
