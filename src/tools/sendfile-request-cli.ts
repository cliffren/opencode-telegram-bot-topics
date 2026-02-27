#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";

type ParsedArgs = {
  filePath: string;
  chatId?: number;
  threadId?: number;
  verbose: boolean;
};

function printUsage(): void {
  process.stdout.write(
    "Usage: opencode-telegram-topics-sendfile <file-path> [--chat-id <id>] [--thread-id <id>] [--verbose]\n",
  );
}

function parseArgs(argv: string[]): ParsedArgs | null {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    return null;
  }

  const filePath = argv[0]?.trim();
  if (!filePath) {
    return null;
  }

  let chatId: number | undefined;
  let threadId: number | undefined;
  let verbose = false;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--chat-id") {
      const raw = argv[i + 1];
      i += 1;
      if (!raw || Number.isNaN(Number(raw))) {
        throw new Error("Invalid --chat-id value");
      }
      chatId = Number(raw);
      continue;
    }

    if (arg === "--thread-id") {
      const raw = argv[i + 1];
      i += 1;
      if (!raw || Number.isNaN(Number(raw))) {
        throw new Error("Invalid --thread-id value");
      }
      threadId = Number(raw);
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { filePath, chatId, threadId, verbose };
}

function buildRequestFilePath(): string {
  const runtimePaths = getRuntimePaths();
  const requestsDir = path.join(runtimePaths.runDirPath, "sendfile-requests");
  const unique = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(requestsDir, `${unique}.json`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const requestPath = buildRequestFilePath();
  await fs.mkdir(path.dirname(requestPath), { recursive: true });

  const payload = {
    path: parsed.filePath,
    chatId: parsed.chatId,
    threadId: parsed.threadId,
    requestedAt: new Date().toISOString(),
    host: os.hostname(),
  };

  await fs.writeFile(requestPath, `${JSON.stringify(payload)}\n`, "utf-8");
  if (parsed.verbose) {
    process.stdout.write(`Queued send-file request: ${parsed.filePath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`opencode-telegram-topics-sendfile failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
