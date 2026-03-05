import { promises as fs } from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import { logger } from "../utils/logger.js";

const REQUESTS_DIR_NAME = "bg-dispatch-requests";

export interface BgDispatchRequest {
  taskId: string;
}

let processing = false;

function getRequestsDirPath(): string {
  return path.join(getRuntimePaths().runDirPath, REQUESTS_DIR_NAME);
}

function buildRequestFilePath(): string {
  const unique = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(getRequestsDirPath(), `${unique}.json`);
}

function isValidRequest(input: unknown): input is BgDispatchRequest {
  if (!input || typeof input !== "object") {
    return false;
  }
  const parsed = input as Partial<BgDispatchRequest>;
  return typeof parsed.taskId === "string" && parsed.taskId.length > 0;
}

export async function enqueueBgDispatchRequest(request: BgDispatchRequest): Promise<void> {
  const requestFilePath = buildRequestFilePath();
  await fs.mkdir(path.dirname(requestFilePath), { recursive: true });
  await fs.writeFile(requestFilePath, `${JSON.stringify(request)}\n`, "utf-8");
}

export async function processBgDispatchRequests(
  handler: (request: BgDispatchRequest) => Promise<void>,
): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;

  const requestsDir = getRequestsDirPath();
  try {
    await fs.mkdir(requestsDir, { recursive: true });

    const entries = (await fs.readdir(requestsDir)).filter((name) => name.endsWith(".json")).sort();
    for (const entry of entries) {
      const filePath = path.join(requestsDir, entry);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (!isValidRequest(parsed)) {
          logger.warn(`[BgDispatch] Invalid request payload: ${entry}`);
          continue;
        }
        await handler(parsed);
      } catch (error) {
        logger.error(`[BgDispatch] Failed to process request: ${entry}`, error);
      } finally {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  } finally {
    processing = false;
  }
}
