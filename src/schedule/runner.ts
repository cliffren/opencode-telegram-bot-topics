import { opencodeClient } from "../opencode/client.js";
import {
  getDueScheduledTasks,
  markScheduledTaskRunFailure,
  markScheduledTaskRunSuccess,
} from "./manager.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import type { ScheduledTask } from "./types.js";

const RUNNER_TICK_INTERVAL_MS = 10_000;
const BUSY_RETRY_MESSAGE = "session is busy";

let runnerTimer: ReturnType<typeof setInterval> | null = null;
let tickInProgress = false;
let executeTaskPrompt: ((task: ScheduledTask) => Promise<void>) | null = null;

export interface ScheduleRunnerDependencies {
  executeTaskPrompt?: (task: ScheduledTask) => Promise<void>;
}

export function configureScheduleRunner(dependencies: ScheduleRunnerDependencies): void {
  executeTaskPrompt = dependencies.executeTaskPrompt ?? null;
}

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });
    if (error || !data) {
      return false;
    }

    const status = (data as Record<string, { type?: string }>)[sessionId];
    return status?.type === "busy";
  } catch {
    return false;
  }
}

async function runTaskPrompt(task: ScheduledTask): Promise<void> {
  if (executeTaskPrompt) {
    await executeTaskPrompt(task);
    return;
  }

  const { error } = await opencodeClient.session.prompt({
    sessionID: task.scope.sessionId,
    directory: task.scope.directory,
    parts: [{ type: "text", text: task.prompt }],
  });

  if (error) {
    throw error;
  }
}

async function executeDueTasks(): Promise<void> {
  if (tickInProgress) {
    return;
  }

  tickInProgress = true;
  try {
    const dueTasks = getDueScheduledTasks(new Date());
    for (const task of dueTasks) {
      try {
        const busy = await isSessionBusy(task.scope.sessionId, task.scope.directory);
        if (busy) {
          await markScheduledTaskRunFailure(task.id, BUSY_RETRY_MESSAGE);
          continue;
        }

        await runTaskPrompt(task);

        await markScheduledTaskRunSuccess(task.id);
        logger.info(
          `[ScheduleRunner] Task triggered: id=${task.id}, session=${task.scope.sessionId}, runCount=${task.runCount + 1}`,
        );
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        await markScheduledTaskRunFailure(task.id, errorText);
        logger.error(`[ScheduleRunner] Scheduled task failed: id=${task.id}`, error);
      }
    }
  } finally {
    tickInProgress = false;
  }
}

export function ensureScheduleRunnerStarted(): void {
  if (runnerTimer) {
    return;
  }

  runnerTimer = setInterval(() => {
    safeBackgroundTask({
      taskName: "schedule.runner.tick",
      task: executeDueTasks,
    });
  }, RUNNER_TICK_INTERVAL_MS);

  safeBackgroundTask({
    taskName: "schedule.runner.initialTick",
    task: executeDueTasks,
  });

  logger.info(`[ScheduleRunner] Started (tick=${RUNNER_TICK_INTERVAL_MS}ms)`);
}
