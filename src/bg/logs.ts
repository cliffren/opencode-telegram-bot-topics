import { promises as fs } from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";

const BG_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function getBgLogsDirPath(): string {
  return path.join(getRuntimePaths().runDirPath, "bg-logs");
}

export function getBgLogFilePath(taskId: string): string {
  return path.join(getBgLogsDirPath(), `${taskId}.log`);
}

export async function ensureBgLogsDir(): Promise<void> {
  await fs.mkdir(getBgLogsDirPath(), { recursive: true });
}

export async function cleanupBgLogs(retentionMs: number = BG_LOG_RETENTION_MS): Promise<number> {
  const dir = getBgLogsDirPath();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (now - stat.mtimeMs > retentionMs) {
        await fs.unlink(fullPath);
        removed += 1;
      }
    } catch {}
  }

  return removed;
}
