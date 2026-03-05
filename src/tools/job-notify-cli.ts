#!/usr/bin/env node

import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { getRuntimePaths } from "../runtime/paths.js";
import { t } from "../i18n/index.js";
import { loadSettings } from "../settings/manager.js";
import {
  applyBgNotify,
  markBgPostActionResult,
  markBgTaskNotificationSent,
} from "../bg/manager.js";
import { ensureBgLogsDir, getBgLogFilePath } from "../bg/logs.js";
import { enqueueBgPostActionRequest } from "../bg/post-action-requests.js";

type NotifyStatus = "started" | "done" | "failed";

interface ParsedArgs {
  jobId: string;
  token: string;
  title?: string;
  status?: NotifyStatus;
  summary?: string;
  pid?: number;
  runBg?: string;
  logPath?: string;
  modelNote?: string;
}

function usageText(): string {
  return [
    "Usage:",
    "  opencode-telegram-job-notify --job-id <id> --token <token> [--title <short>] --status started|done|failed [--summary <text>] [--pid <pid>] [--log-path <path>]",
    '  opencode-telegram-job-notify --job-id <id> --token <token> [--title <short>] [--model-note <text>] --run-bg "<command>"',
  ].join("\n");
}

function parseArgs(argv: string[]): ParsedArgs {
  let jobId = "";
  let token = "";
  let title: string | undefined;
  let status: NotifyStatus | undefined;
  let summary: string | undefined;
  let pid: number | undefined;
  let runBg: string | undefined;
  let logPath: string | undefined;
  let modelNote: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];

    if (arg === "--job-id") { jobId = value ?? ""; i += 1; continue; }
    if (arg === "--token") { token = value ?? ""; i += 1; continue; }
    if (arg === "--title") { title = value; i += 1; continue; }
    if (arg === "--status") {
      if (value === "started" || value === "done" || value === "failed") status = value;
      i += 1; continue;
    }
    if (arg === "--summary") { summary = value; i += 1; continue; }
    if (arg === "--pid") {
      const n = Number.parseInt(value ?? "", 10);
      if (Number.isInteger(n) && n > 0) pid = n;
      i += 1; continue;
    }
    if (arg === "--run-bg") { runBg = value; i += 1; continue; }
    if (arg === "--log-path") { logPath = value; i += 1; continue; }
    if (arg === "--model-note") { modelNote = value; i += 1; continue; }
  }

  if (!jobId || !token) throw new Error(usageText());
  if (!runBg && !status) throw new Error(usageText());

  return { jobId, token, title, status, summary, pid, runBg, logPath, modelNote };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'"`)}'`;
}

async function sendTelegramMessage(
  token: string,
  chatId: number,
  threadId: number | null,
  text: string,
): Promise<void> {
  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (typeof threadId === "number") {
    payload.message_thread_id = threadId;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Telegram API failed: ${response.status}`);
  }
}

function formatNotifyText(taskTitle: string, status: NotifyStatus, summary?: string): string {
  const title = taskTitle.trim().length > 0 ? taskTitle.trim() : t("bg.notify.default_title");
  const key = status === "started" ? "bg.notify.started" : status === "done" ? "bg.notify.done" : "bg.notify.failed";
  const base = t(key, { title });
  return summary ? `${base}\n${summary}` : base;
}

function summarizeFromLogPath(logPath: string | undefined): string | undefined {
  if (!logPath || logPath.trim().length === 0) {
    return undefined;
  }
  return t("bg.notify.log_path", { path: logPath });
}

async function applyNotify(parsed: ParsedArgs, telegramToken: string): Promise<void> {
  if (!parsed.status) {
    throw new Error("Missing status");
  }

  const result = await applyBgNotify({
    taskId: parsed.jobId,
    token: parsed.token,
    status: parsed.status,
    title: parsed.title,
    summary: parsed.summary ?? summarizeFromLogPath(parsed.logPath),
    pid: parsed.pid,
    logPath: parsed.logPath,
  });

  if (result.code !== "ok") {
    process.stderr.write(`bg notify rejected: ${result.code}\n`);
    if (result.code === "not_found") {
      process.exitCode = 10;
      return;
    }
    if (result.code === "invalid_token") {
      process.exitCode = 12;
      return;
    }
    if (result.code === "already_settled") {
      process.exitCode = 11;
      return;
    }
  }

  if (!result.task) {
    process.exitCode = 1;
    return;
  }

  if (parsed.status === "done" || parsed.status === "failed") {
    if (!result.task.notificationSentAt) {
      const text = formatNotifyText(result.task.title, parsed.status, parsed.summary);
      try {
        await sendTelegramMessage(
          telegramToken,
          result.task.scope.chatId,
          result.task.scope.threadId,
          text,
        );
        await markBgTaskNotificationSent(result.task.id);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        process.stderr.write(`bg notify send failed: ${errorText}\n`);
      }
    }

    const postAction = result.task.postAction ?? { type: "none" as const };
    if (postAction.type !== "none" && result.task.postActionStatus !== "sent") {
      try {
        const lines = [
          "Background task finished.",
          `Title: ${result.task.title}`,
          `Status: ${parsed.status === "done" ? "success" : "failed"}`,
        ];
        if (result.task.summary) {
          lines.push(`Summary: ${result.task.summary}`);
        }
        if (result.task.logPath) {
          lines.push(`Log path: ${result.task.logPath}`);
        }
        if (parsed.modelNote) {
          lines.push(`Model note: ${parsed.modelNote}`);
        }
        if (postAction.type === "summarize") {
          lines.push("Please summarize the task result for user in concise Chinese.");
        }
        if (postAction.type === "custom" && postAction.prompt) {
          lines.push("Follow-up instruction:");
          lines.push(postAction.prompt);
        }
        await enqueueBgPostActionRequest({
          taskId: result.task.id,
          scope: result.task.scope,
          prompt: lines.join("\n"),
        });
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        await markBgPostActionResult(result.task.id, "failed", errorText);
      }
    }
  }
}

function spawnBackgroundWrapper(parsed: ParsedArgs): number {
  if (!parsed.runBg) {
    throw new Error("Missing --run-bg value");
  }
  const nodeBin = process.execPath;
  const scriptPath = process.argv[1];
  const logFilePath = parsed.logPath ?? getBgLogFilePath(parsed.jobId);
  const locatorArgs = [
    `--job-id ${shellQuote(parsed.jobId)}`,
    `--token ${shellQuote(parsed.token)}`,
    parsed.title ? `--title ${shellQuote(parsed.title)}` : "",
    parsed.modelNote ? `--model-note ${shellQuote(parsed.modelNote)}` : "",
  ].filter(Boolean).join(" ");
  const runtimeEnvPrefix = [
    process.env.OPENCODE_TELEGRAM_RUNTIME_MODE
      ? `OPENCODE_TELEGRAM_RUNTIME_MODE=${process.env.OPENCODE_TELEGRAM_RUNTIME_MODE}`
      : "",
    process.env.OPENCODE_TELEGRAM_HOME
      ? `OPENCODE_TELEGRAM_HOME=${shellQuote(process.env.OPENCODE_TELEGRAM_HOME)}`
      : "",
  ].filter(Boolean).join(" ");
  const notifyBase = `${runtimeEnvPrefix ? `${runtimeEnvPrefix} ` : ""}${shellQuote(nodeBin)} ${shellQuote(scriptPath)} ${locatorArgs}`;
  const wrapper = [
    `bash -lc ${shellQuote(parsed.runBg)} >> ${shellQuote(logFilePath)} 2>&1`,
    "code=$?",
    `if [ "$code" -eq 0 ]; then ${notifyBase} --status done --log-path ${shellQuote(logFilePath)}; else ${notifyBase} --status failed --summary "exit code=$code" --log-path ${shellQuote(logFilePath)}; fi`,
  ].join("; ");
  const detached = spawn("bash", ["-lc", wrapper], { detached: true, stdio: "ignore" });
  if (!detached.pid) {
    throw new Error("Failed to spawn background process");
  }
  detached.unref();
  return detached.pid;
}

async function runBackgroundMode(parsed: ParsedArgs, telegramToken: string): Promise<void> {
  await ensureBgLogsDir();
  const logFilePath = parsed.logPath ?? getBgLogFilePath(parsed.jobId);
  const pid = spawnBackgroundWrapper(parsed);
  await applyNotify(
    {
      ...parsed,
      status: "started",
      pid,
      summary: parsed.summary,
      logPath: logFilePath,
    },
    telegramToken,
  );
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const runtimePaths = getRuntimePaths();
  dotenv.config({ path: runtimePaths.envFilePath });
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }
  await loadSettings();
  if (parsed.runBg) {
    await runBackgroundMode(parsed, telegramToken);
    return;
  }
  await applyNotify(parsed, telegramToken);
}

main().catch((error) => {
  process.stderr.write(`opencode-telegram-job-notify failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
