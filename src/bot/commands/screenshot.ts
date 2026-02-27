import { CommandContext, Context, InputFile } from "grammy";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { getPromptThreadId } from "../handlers/prompt.js";

const execFileAsync = promisify(execFile);

function getScreenshotDir(): string {
  if (config.files.autoSendImagesDir.trim()) {
    return config.files.autoSendImagesDir;
  }

  if (config.files.tempDir?.trim()) {
    return path.join(config.files.tempDir, "screenshots");
  }

  return path.join(os.tmpdir(), "opencode-telegram-screenshots");
}

function getScreenshotPath(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(getScreenshotDir(), `screenshot-${timestamp}.png`);
}

function resolveThreadIdFromContext(ctx: Context): number | null {
  const messageThreadId = ctx.message?.message_thread_id;
  if (typeof messageThreadId === "number") {
    return messageThreadId;
  }

  const callbackMessage = ctx.callbackQuery?.message;
  if (callbackMessage && "message_thread_id" in callbackMessage) {
    const callbackThreadId = (callbackMessage as { message_thread_id?: number }).message_thread_id;
    if (typeof callbackThreadId === "number") {
      return callbackThreadId;
    }
  }

  return getPromptThreadId();
}

function isThreadNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /message thread not found/i.test(error.message);
}

export function isScreenshotRequestText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const negativeIntent = /(不要|别|无需|不用).*(发|发送|传)|do\s*not\s*(send|share)/i.test(text);
  if (negativeIntent) {
    return false;
  }

  if (
    ["screenshot", "take screenshot", "capture screenshot", "截图", "截屏", "屏幕截图"].includes(
      normalized,
    )
  ) {
    return true;
  }

  const hasZhScreenshot = /(屏幕截图|截屏|截图|截个图|截张图|截一下图)/.test(text);
  const hasZhSend = /(发给我|发我|发送给我|传给我|给我看|发一下|发过来|传过来)/.test(text);
  const zhIntent = hasZhScreenshot && (hasZhSend || /(帮我|给我|请|麻烦)/.test(text));
  if (zhIntent) {
    return true;
  }

  const hasEnScreenshot = /(take|capture|make|grab).*(a\s*)?(screenshot)|\bscreenshot\b/i.test(text);
  const hasEnSend = /(send|share|post).*(to\s*)?me|\bshow\s+me\b/i.test(text);
  const enIntent = hasEnScreenshot && (hasEnSend || /(please|can you|could you)/i.test(text));
  return enIntent;
}

export async function captureAndSendScreenshot(ctx: Context): Promise<boolean> {
  if (process.platform !== "darwin") {
    await ctx.reply(t("screenshot.unsupported"));
    return false;
  }

  const status = await ctx.reply(t("screenshot.capturing"));
  const outputPath = getScreenshotPath();
  const threadId = resolveThreadIdFromContext(ctx);

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await execFileAsync("/usr/sbin/screencapture", ["-x", outputPath]);

    const stats = await fs.stat(outputPath);
    const sizeKb = Math.floor(stats.size / 1024);
    if (sizeKb > config.files.maxFileSizeKb) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        status.message_id,
        t("sendfile.too_large", { size: sizeKb, limit: config.files.maxFileSizeKb }),
      );
      return false;
    }

    logger.debug(
      `[Screenshot] Sending screenshot with threadId=${threadId ?? "none"}, chatId=${ctx.chat?.id ?? "none"}`,
    );

    await ctx.replyWithDocument(new InputFile(outputPath), {
      caption: path.basename(outputPath),
      message_thread_id: threadId ?? undefined,
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      status.message_id,
      t("screenshot.sent"),
    );

    logger.info(`[Screenshot] Captured and sent: ${outputPath}`);
    return true;
  } catch (err) {
    logger.error("[Screenshot] Failed to capture/send screenshot:", err);

    const failMessage = isThreadNotFoundError(err)
      ? t("screenshot.failed_thread")
      : t("screenshot.failed");

    await ctx.api
      .editMessageText(ctx.chat!.id, status.message_id, failMessage)
      .catch(async () => {
        await ctx.reply(failMessage);
      });

    return false;
  }
}

export async function screenshotCommand(ctx: CommandContext<Context>): Promise<void> {
  await captureAndSendScreenshot(ctx);
}
