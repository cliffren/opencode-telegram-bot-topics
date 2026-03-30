import { CommandContext, Context, InputFile } from "grammy";
import { promises as fs } from "fs";
import * as path from "path";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { config } from "../../config.js";
import { getCurrentSessionByThread } from "../handlers/prompt.js";

const FUZZY_SEARCH_MAX_FILES = 20000;
const FUZZY_SEARCH_MAX_MATCHES = 30;

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

  return null;
}

function resolveCandidatePaths(filePath: string, currentDirectory?: string | null): string[] {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    return [];
  }

  if (path.isAbsolute(trimmedPath)) {
    return [trimmedPath];
  }

  const candidates = new Set<string>();
  if (currentDirectory) {
    candidates.add(path.resolve(currentDirectory, trimmedPath));
  }

  candidates.add(path.resolve(process.cwd(), trimmedPath));
  return Array.from(candidates);
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function computeMatchScore(queryRaw: string, absolutePath: string): number {
  const query = normalizePathForMatch(queryRaw.trim());
  const fullPath = normalizePathForMatch(absolutePath);
  const fileName = normalizePathForMatch(path.basename(absolutePath));

  if (!query) {
    return 0;
  }

  const queryHasSeparator = query.includes("/");

  if (queryHasSeparator) {
    if (fullPath.endsWith(query)) return 120;
    if (fullPath.includes(query)) return 90;
    return 0;
  }

  if (fileName === query) return 100;
  if (fileName.startsWith(query)) return 80;
  if (fileName.includes(query)) return 65;
  if (fullPath.includes(query)) return 40;
  return 0;
}

async function fuzzyFindFileCandidates(searchRoots: string[], query: string): Promise<string[]> {
  const roots = Array.from(new Set(searchRoots.map((root) => path.resolve(root))));
  const matches: Array<{ file: string; score: number }> = [];
  let scannedFiles = 0;

  for (const root of roots) {
    const stack: string[] = [root];

    while (
      stack.length > 0 &&
      scannedFiles < FUZZY_SEARCH_MAX_FILES &&
      matches.length < FUZZY_SEARCH_MAX_MATCHES
    ) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
      try {
        const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
        entries = dirEntries.map((entry) => ({
          name: String(entry.name),
          isDirectory: () => entry.isDirectory(),
          isFile: () => entry.isFile(),
        }));
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name === ".git" || entry.name === "node_modules") {
            continue;
          }
          stack.push(path.join(currentDir, entry.name));
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        scannedFiles += 1;
        const candidatePath = path.join(currentDir, entry.name);
        const score = computeMatchScore(query, candidatePath);
        if (score > 0) {
          matches.push({ file: candidatePath, score });
        }

        if (scannedFiles >= FUZZY_SEARCH_MAX_FILES || matches.length >= FUZZY_SEARCH_MAX_MATCHES) {
          break;
        }
      }
    }
  }

  matches.sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  return Array.from(new Set(matches.map((item) => item.file)));
}

export async function findFileCandidatesForRequest(
  filePath: string,
  currentDirectory?: string | null,
): Promise<string[]> {
  const candidatePaths = resolveCandidatePaths(filePath, currentDirectory);
  const exactFileMatches: string[] = [];

  for (const candidatePath of candidatePaths) {
    try {
      const stats = await fs.stat(candidatePath);
      if (stats.isFile()) {
        exactFileMatches.push(candidatePath);
      }
    } catch {
      continue;
    }
  }

  if (exactFileMatches.length > 0) {
    return Array.from(new Set(exactFileMatches));
  }

  const rootsForFuzzySearch = Array.from(
    new Set(
      [currentDirectory, process.cwd()].filter((value): value is string =>
        Boolean(value && value.trim()),
      ),
    ),
  );

  return fuzzyFindFileCandidates(rootsForFuzzySearch, filePath);
}

async function resolveFileForSending(
  filePath: string,
  currentDirectory?: string | null,
): Promise<{ absolutePath: string; stats: Awaited<ReturnType<typeof fs.stat>> } | null> {
  const candidatePaths = resolveCandidatePaths(filePath, currentDirectory);
  if (candidatePaths.length === 0) {
    return null;
  }

  for (const candidatePath of candidatePaths) {
    try {
      const candidateStats = await fs.stat(candidatePath);
      return { absolutePath: candidatePath, stats: candidateStats };
    } catch {
      continue;
    }
  }

  const fuzzyMatches = await findFileCandidatesForRequest(filePath, currentDirectory);
  if (fuzzyMatches.length > 0) {
    const absolutePath = fuzzyMatches[0];
    const stats = await fs.stat(absolutePath);
    logger.info(`[SendFile] Fuzzy matched path: ${absolutePath} (query: ${filePath})`);
    return { absolutePath, stats };
  }

  logger.warn(
    `[SendFile] File not found. Requested: ${filePath}. Tried: ${candidatePaths.join(", ")}`,
  );
  return null;
}

export async function sendFileByApi(
  api: Context["api"],
  chatId: number,
  threadId: number | null,
  filePath: string,
): Promise<
  | { ok: true; absolutePath: string }
  | { ok: false; reason: "not_found" | "not_file" | "too_large" | "send_error" }
> {
  const currentSession = getCurrentSessionByThread(threadId, chatId);
  const resolved = await resolveFileForSending(filePath, currentSession?.directory);
  if (!resolved) {
    return { ok: false, reason: "not_found" };
  }

  if (!resolved.stats.isFile()) {
    return { ok: false, reason: "not_file" };
  }

  const fileSizeKb = Math.floor(Number(resolved.stats.size) / 1024);
  if (fileSizeKb > config.files.maxFileSizeKb) {
    return { ok: false, reason: "too_large" };
  }

  try {
    await api.sendDocument(chatId, new InputFile(resolved.absolutePath), {
      caption: filePath,
      message_thread_id: threadId ?? undefined,
    });

    return { ok: true, absolutePath: resolved.absolutePath };
  } catch (error) {
    logger.error("[SendFile] sendFileByApi failed:", error);
    return { ok: false, reason: "send_error" };
  }
}

export async function sendFileToChat(ctx: Context, filePath: string): Promise<boolean> {
  if (!filePath.trim()) {
    await ctx.reply(t("sendfile.usage"));
    return false;
  }

  try {
    const threadId = resolveThreadIdFromContext(ctx);
    const currentSession = getCurrentSessionByThread(threadId, ctx.chat?.id ?? null);
    const resolved = await resolveFileForSending(filePath, currentSession?.directory);
    if (!resolved) {
      await ctx.reply(t("sendfile.file_not_found"));
      return false;
    }

    if (!resolved.stats.isFile()) {
      await ctx.reply(t("sendfile.not_a_file"));
      return false;
    }

    const fileSizeKb = Math.floor(Number(resolved.stats.size) / 1024);
    if (fileSizeKb > config.files.maxFileSizeKb) {
      await ctx.reply(
        t("sendfile.too_large", { size: fileSizeKb, limit: config.files.maxFileSizeKb }),
      );
      return false;
    }

    logger.info(`[SendFile] Sending file: ${resolved.absolutePath}`);

    await ctx.replyWithDocument(new InputFile(resolved.absolutePath), {
      caption: filePath,
      message_thread_id: threadId ?? undefined,
    });

    return true;
  } catch (error) {
    logger.error("[SendFile] Error sending file:", error);
    await ctx.reply(t("sendfile.error"));
    return false;
  }
}

export async function sendfileCommand(ctx: CommandContext<Context>) {
  const args = ctx.match;
  if (!args) {
    await ctx.reply(t("sendfile.usage"));
    return;
  }

  const filePath = args.trim();

  if (!filePath) {
    await ctx.reply(t("sendfile.usage"));
    return;
  }

  await sendFileToChat(ctx, filePath);
}
