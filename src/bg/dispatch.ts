import { opencodeClient } from "../opencode/client.js";
import { findBgTask } from "./manager.js";
import { getRuntimePaths } from "../runtime/paths.js";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../utils/logger.js";
import type { BgTask } from "./types.js";

const BG_DISPATCH_TIMEOUT_MS = 120_000;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Resolve the notify binary path.
 * Priority:
 * 1. OPENCODE_TELEGRAM_JOB_NOTIFY_BIN env override
 * 2. Local compiled script (same dist dir as bot entry point) — most reliable, no global install needed
 * 3. Common global install locations
 * 4. Bare name (relies on PATH)
 */
function resolveNotifyBinary(): string {
  const override = process.env.OPENCODE_TELEGRAM_JOB_NOTIFY_BIN?.trim();
  if (override) {
    return override;
  }

  // process.argv[1] is the bot entry point, e.g. /path/to/dist/app.js
  // job-notify-cli.js lives in the same dist tree: /path/to/dist/tools/job-notify-cli.js
  const botEntryDir = path.dirname(process.argv[1]);
  const localScript = path.join(botEntryDir, "tools", "job-notify-cli.js");
  if (existsSync(localScript)) {
    return `${shellQuote(process.execPath)} ${shellQuote(localScript)}`;
  }

  // Common global install locations
  const candidates = [
    path.join(os.homedir(), ".npm-global", "bin", "opencode-telegram-job-notify"),
    "/opt/homebrew/bin/opencode-telegram-job-notify",
    "/usr/local/bin/opencode-telegram-job-notify",
    path.join(os.homedir(), ".local", "bin", "opencode-telegram-job-notify"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return shellQuote(candidate);
    }
  }

  // Last resort: rely on shell PATH
  return "opencode-telegram-job-notify";
}

function buildInjectedBgPrompt(task: BgTask): string {
  const runtimePaths = getRuntimePaths();
  const notifyBin = resolveNotifyBinary();

  const envPrefix = [
    `OPENCODE_TELEGRAM_RUNTIME_MODE=${runtimePaths.mode}`,
    `OPENCODE_TELEGRAM_HOME=${shellQuote(runtimePaths.appHome)}`,
  ].join(" ");

  const commonArgs = [
    envPrefix,
    notifyBin,
    "--job-id",
    shellQuote(task.id),
    "--token",
    shellQuote(task.token),
    "--title",
    shellQuote(task.title),
  ].join(" ");

  const wrapperWithPlaceholder = `${commonArgs} --run-bg '<YOUR_COMMAND>'`;
  const exampleWrapper = `${commonArgs} --run-bg 'python train.py --epochs 100'`;

  return [
    "## BACKGROUND TASK",
    "",
    "Your ONLY job: determine the exact shell command that fulfills the user's request,",
    "then launch it using the notification wrapper below.",
    "",
    "### Wrapper command (replace <YOUR_COMMAND> with the real shell command):",
    `    ${wrapperWithPlaceholder}`,
    "",
    "### Rules:",
    "1. Replace '<YOUR_COMMAND>' with a single-quoted shell command (escape inner single quotes as '\"'\"' if needed).",
    "2. Use ONLY this wrapper — never use & or nohup or disown directly.",
    "3. The wrapper handles backgrounding, stdout/stderr logging, and completion notification automatically.",
    "4. After the wrapper exits successfully, send the user ONE short confirmation message, then STOP.",
    "5. Do NOT run any further tools or steps after the confirmation.",
    "",
    "### Example:",
    `    ${exampleWrapper}`,
    "",
    "### User's task:",
    task.prompt,
  ].join("\n");
}

export async function dispatchBgTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const task = findBgTask(taskId);
  if (!task) {
    return { ok: false, error: "task_not_found" };
  }

  logger.info(`[BG] Dispatch: taskId=${task.id}, session=${task.scope.sessionId}`);

  const promptResult = await Promise.race([
    opencodeClient.session.prompt({
      sessionID: task.scope.sessionId,
      directory: task.scope.directory,
      parts: [{ type: "text", text: buildInjectedBgPrompt(task) }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`dispatch_timeout after ${BG_DISPATCH_TIMEOUT_MS}ms`)),
        BG_DISPATCH_TIMEOUT_MS,
      ),
    ),
  ]).catch((err: unknown) => {
    logger.error(`[BG] Dispatch failed: taskId=${task.id}`, err);
    return { error: err };
  });

  if (!promptResult || typeof promptResult !== "object") {
    return { ok: false, error: "dispatch_failed_unknown" };
  }

  const { error } = promptResult as { error?: unknown };
  if (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    logger.error(`[BG] Dispatch returned error: taskId=${task.id}`, errorText);
    return { ok: false, error: errorText };
  }

  logger.info(`[BG] Dispatch accepted: taskId=${task.id}`);
  return { ok: true };
}
