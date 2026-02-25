import { promises as fs } from "node:fs";
import path from "node:path";
import type { Bot, Context } from "grammy";
import { getRuntimePaths } from "../../runtime/paths.js";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { sendFileByApi } from "../commands/sendfile.js";

const REQUESTS_DIR_NAME = "sendfile-requests";

type SendFileRequest = {
  path: string;
  chatId?: number;
  threadId?: number | null;
};

function getRequestsDirPath(): string {
  if (config.external.sendFileRequestsDir?.trim()) {
    return path.resolve(config.external.sendFileRequestsDir);
  }

  return path.join(getRuntimePaths().runDirPath, REQUESTS_DIR_NAME);
}

async function readRequestFile(filePath: string): Promise<SendFileRequest | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SendFileRequest;
    if (!parsed.path || typeof parsed.path !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function processExternalSendFileRequests(
  bot: Bot<Context>,
  fallbackChatId: number | null,
  fallbackThreadId: number | null,
): Promise<void> {
  const requestsDir = getRequestsDirPath();

  try {
    await fs.mkdir(requestsDir, { recursive: true });
  } catch (error) {
    logger.error("[SendFileExternal] Failed to create request dir:", error);
    return;
  }

  let entries: string[] = [];
  try {
    entries = (await fs.readdir(requestsDir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    logger.error("[SendFileExternal] Failed to read request dir:", error);
    return;
  }

  for (const entry of entries) {
    const requestPath = path.join(requestsDir, entry);
    const request = await readRequestFile(requestPath);
    const chatId = request?.chatId ?? fallbackChatId ?? config.telegram.allowedUserId;
    const threadId = request?.threadId ?? fallbackThreadId ?? null;

    if (!request) {
      logger.warn(`[SendFileExternal] Invalid request payload: ${entry}`);
      await fs.unlink(requestPath).catch(() => {});
      continue;
    }

    const result = await sendFileByApi(bot.api, chatId, threadId, request.path);
    if (result.ok) {
      logger.info(`[SendFileExternal] Sent requested file: ${result.absolutePath}`);
    } else {
      logger.warn(
        `[SendFileExternal] Failed to send requested file. path=${request.path}, reason=${result.reason}`,
      );
      await bot.api
        .sendMessage(chatId, `Failed to send file: ${request.path} (${result.reason})`, {
          message_thread_id: threadId ?? undefined,
        })
        .catch(() => {});
    }

    await fs.unlink(requestPath).catch(() => {});
  }
}
