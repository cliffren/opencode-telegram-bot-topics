import { Context } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import { config } from "../../config.js";
import { processUserPrompt, type ProcessPromptDeps, type PromptFilePartInput } from "./prompt.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const TEMP_DIR = config.files.tempDir || path.join(os.tmpdir(), "opencode-telegram-images");

const TELEGRAM_DOWNLOAD_TIMEOUT_MS = 30_000;
const TELEGRAM_DOWNLOAD_MAX_REDIRECTS = 3;
const TEMP_FILE_CLEANUP_DELAY_MS = 10 * 60_000;

let telegramDownloadAgent: https.RequestOptions["agent"] | null | undefined;

function getTelegramDownloadAgent(): https.RequestOptions["agent"] | undefined {
  if (telegramDownloadAgent !== undefined) {
    return telegramDownloadAgent || undefined;
  }

  const proxyUrl = config.telegram.proxyUrl.trim();
  if (!proxyUrl) {
    telegramDownloadAgent = null;
    return undefined;
  }

  telegramDownloadAgent = proxyUrl.startsWith("socks")
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);

  logger.info(`[Image] Using Telegram download proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
  return telegramDownloadAgent;
}

async function downloadTelegramFileByUrl(url: string, redirectDepth: number = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const requestModule = targetUrl.protocol === "http:" ? http : https;

    const request = requestModule.get(
      targetUrl,
      { agent: getTelegramDownloadAgent() },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume();

          if (redirectDepth >= TELEGRAM_DOWNLOAD_MAX_REDIRECTS) {
            reject(new Error("Too many redirects while downloading Telegram file"));
            return;
          }

          const redirectUrl = new URL(response.headers.location, targetUrl).toString();
          void downloadTelegramFileByUrl(redirectUrl, redirectDepth + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Telegram file download failed with HTTP ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });

        response.on("end", () => {
          resolve(Buffer.concat(chunks));
        });

        response.on("error", reject);
      },
    );

    request.on("error", reject);
    request.setTimeout(TELEGRAM_DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(
        new Error(`Telegram file download timed out after ${TELEGRAM_DOWNLOAD_TIMEOUT_MS}ms`),
      );
    });
  });
}

async function downloadTelegramFile(
  ctx: Context,
  fileId: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    const file = await ctx.api.getFile(fileId);

    if (!file.file_path) {
      logger.error("[Image] Telegram getFile returned no file_path");
      return null;
    }

    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    logger.debug(`[Image] Downloading file: ${file.file_path} (${file.file_size ?? "?"} bytes)`);

    const buffer = await downloadTelegramFileByUrl(fileUrl);

    const filename = file.file_path.split("/").pop() || "image.jpg";

    logger.debug(`[Image] Downloaded file: ${filename} (${buffer.length} bytes)`);
    return { buffer, filename };
  } catch (err) {
    logger.error("[Image] Error downloading file from Telegram:", err);
    return null;
  }
}

function detectMimeType(filename: string, telegramDocumentMimeType?: string): string {
  if (telegramDocumentMimeType && telegramDocumentMimeType.trim()) {
    return telegramDocumentMimeType;
  }

  const extension = path.extname(filename).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}

function scheduleTempFileCleanup(filePath: string): void {
  const timer = setTimeout(() => {
    void fs.unlink(filePath)
      .then(() => logger.debug(`[Image] Cleaned up temp file: ${filePath}`))
      .catch(() => {});
  }, TEMP_FILE_CLEANUP_DELAY_MS);

  timer.unref();
}

export async function handleImageMessage(ctx: Context, deps: ProcessPromptDeps): Promise<void> {
  const photo = ctx.message?.photo;
  const document = ctx.message?.document;
  const userCaption = ctx.message?.caption;

  let fileId: string | undefined;

  if (photo && photo.length > 0) {
    const largestPhoto = photo[photo.length - 1];
    fileId = largestPhoto.file_id;
  } else if (document) {
    fileId = document.file_id;
  }

  if (!fileId) {
    logger.warn("[Image] Received image/document message with no file_id");
    return;
  }

  logger.info(`[Image] Processing ${document ? "document" : "image"}: ${fileId}, caption: ${userCaption || "none"}`);

  const statusMessage = await ctx.reply(t("image.downloading"));

  try {
    const fileData = await downloadTelegramFile(ctx, fileId);
    if (!fileData) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("image.download_failed"),
      );
      return;
    }

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMessage.message_id,
      t("image.sending_to_opencode"),
    );

    await fs.mkdir(TEMP_DIR, { recursive: true });
    const tempFilePath = path.join(TEMP_DIR, `${Date.now()}-${fileData.filename}`);
    await fs.writeFile(tempFilePath, fileData.buffer);

    const fileUrl = `file://${tempFilePath}`;
    const mime = detectMimeType(fileData.filename, document?.mime_type);

    const filePart: PromptFilePartInput = {
      type: "file",
      mime,
      url: fileUrl,
      filename: fileData.filename,
    };

    let promptText = `[Image analysis: ${fileData.filename}]\nPlease analyze this image`;
    if (userCaption) {
      promptText += `\n\nUser request: ${userCaption}`;
    } else {
      promptText += "\n\nPlease help me with any questions I have about it.";
    }

    logger.info(`[Image] Sending image to OpenCode: ${fileUrl} (${mime})`);

    const sent = await processUserPrompt(ctx, promptText, deps, [filePart]);

    if (sent) {
      scheduleTempFileCleanup(tempFilePath);
    } else {
      await fs.unlink(tempFilePath).catch(() => {});
    }

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMessage.message_id,
      t("image.sent"),
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    logger.error("[Image] Error processing image message:", err);

    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMessage.message_id,
        t("image.error", { error: errorMessage }),
      );
    } catch {
      await ctx.reply(t("image.error", { error: errorMessage })).catch(() => {});
    }
  }
}
