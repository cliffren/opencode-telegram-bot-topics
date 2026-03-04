import type { ModelInfo } from "../model/types.js";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import { logger } from "../utils/logger.js";
import type { ScheduledTask } from "../schedule/types.js";

export interface ProjectInfo {
  id: string;
  worktree: string;
  name?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface ServerProcessInfo {
  pid: number;
  startTime: string; // ISO string
  apiUrl?: string;
  port?: number;
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: Array<{
    worktree: string;
    lastUpdated: number;
  }>;
}

export interface Settings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  scopedSessions?: Record<string, SessionInfo>;
  currentAgent?: string;
  scopedAgents?: Record<string, string>;
  currentModel?: ModelInfo;
  scopedModels?: Record<string, ModelInfo>;
  pinnedMessageId?: number;
  serverProcess?: ServerProcessInfo;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
  scheduledTasks?: ScheduledTask[];
}

function getSettingsFilePath(): string {
  return getRuntimePaths().settingsFilePath;
}

async function readSettingsFile(): Promise<Settings> {
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(getSettingsFilePath(), "utf-8");
    return JSON.parse(content) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("[SettingsManager] Error reading settings file:", error);
    }
    return {};
  }
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

function writeSettingsFile(settings: Settings): Promise<void> {
  settingsWriteQueue = settingsWriteQueue
    .catch(() => {
      // Keep write queue alive after failed writes.
    })
    .then(async () => {
      try {
        const fs = await import("fs/promises");
        const settingsFilePath = getSettingsFilePath();
        await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
        await fs.writeFile(settingsFilePath, JSON.stringify(settings, null, 2));
      } catch (err) {
        logger.error("[SettingsManager] Error writing settings file:", err);
      }
    });

  return settingsWriteQueue;
}

let currentSettings: Settings = {};

export function getCurrentProject(): ProjectInfo | undefined {
  return currentSettings.currentProject;
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  currentSettings.currentProject = projectInfo;
  void writeSettingsFile(currentSettings);
}

export function clearProject(): void {
  currentSettings.currentProject = undefined;
  void writeSettingsFile(currentSettings);
}

export function getCurrentSession(): SessionInfo | undefined {
  return currentSettings.currentSession;
}

export function setCurrentSession(sessionInfo: SessionInfo): void {
  currentSettings.currentSession = sessionInfo;
  void writeSettingsFile(currentSettings);
}

export function clearSession(): void {
  currentSettings.currentSession = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScopedSession(scopeKey: string): SessionInfo | undefined {
  return currentSettings.scopedSessions?.[scopeKey];
}

export function setScopedSession(scopeKey: string, sessionInfo: SessionInfo): void {
  const existing = currentSettings.scopedSessions ?? {};
  currentSettings.scopedSessions = {
    ...existing,
    [scopeKey]: sessionInfo,
  };
  void writeSettingsFile(currentSettings);
}

export function clearScopedSession(scopeKey: string): void {
  if (!currentSettings.scopedSessions || !(scopeKey in currentSettings.scopedSessions)) {
    return;
  }

  const rest = { ...currentSettings.scopedSessions };
  delete rest[scopeKey];
  currentSettings.scopedSessions = rest;
  void writeSettingsFile(currentSettings);
}

export function getCurrentAgent(): string | undefined {
  return currentSettings.currentAgent;
}

export function setCurrentAgent(agentName: string): void {
  currentSettings.currentAgent = agentName;
  void writeSettingsFile(currentSettings);
}

export function clearCurrentAgent(): void {
  currentSettings.currentAgent = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScopedAgent(scopeKey: string): string | undefined {
  return currentSettings.scopedAgents?.[scopeKey];
}

export function setScopedAgent(scopeKey: string, agentName: string): void {
  const existing = currentSettings.scopedAgents ?? {};
  currentSettings.scopedAgents = {
    ...existing,
    [scopeKey]: agentName,
  };
  void writeSettingsFile(currentSettings);
}

export function clearScopedAgent(scopeKey: string): void {
  if (!currentSettings.scopedAgents || !(scopeKey in currentSettings.scopedAgents)) {
    return;
  }

  const rest = { ...currentSettings.scopedAgents };
  delete rest[scopeKey];
  currentSettings.scopedAgents = rest;
  void writeSettingsFile(currentSettings);
}

export function getCurrentModel(): ModelInfo | undefined {
  return currentSettings.currentModel;
}

export function setCurrentModel(modelInfo: ModelInfo): void {
  currentSettings.currentModel = modelInfo;
  void writeSettingsFile(currentSettings);
}

export function clearCurrentModel(): void {
  currentSettings.currentModel = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScopedModel(scopeKey: string): ModelInfo | undefined {
  return currentSettings.scopedModels?.[scopeKey];
}

export function getAllScopedModels(): Record<string, ModelInfo> {
  return { ...(currentSettings.scopedModels ?? {}) };
}

export function setScopedModel(scopeKey: string, modelInfo: ModelInfo): void {
  const existing = currentSettings.scopedModels ?? {};
  currentSettings.scopedModels = {
    ...existing,
    [scopeKey]: modelInfo,
  };
  void writeSettingsFile(currentSettings);
}

export function clearScopedModel(scopeKey: string): void {
  if (!currentSettings.scopedModels || !(scopeKey in currentSettings.scopedModels)) {
    return;
  }

  const rest = { ...currentSettings.scopedModels };
  delete rest[scopeKey];
  currentSettings.scopedModels = rest;
  void writeSettingsFile(currentSettings);
}

export function getPinnedMessageId(): number | undefined {
  return currentSettings.pinnedMessageId;
}

export function setPinnedMessageId(messageId: number): void {
  currentSettings.pinnedMessageId = messageId;
  void writeSettingsFile(currentSettings);
}

export function clearPinnedMessageId(): void {
  currentSettings.pinnedMessageId = undefined;
  void writeSettingsFile(currentSettings);
}

export function getServerProcess(): ServerProcessInfo | undefined {
  return currentSettings.serverProcess;
}

export function setServerProcess(processInfo: ServerProcessInfo): void {
  currentSettings.serverProcess = processInfo;
  void writeSettingsFile(currentSettings);
}

export function clearServerProcess(): void {
  currentSettings.serverProcess = undefined;
  void writeSettingsFile(currentSettings);
}

export function getSessionDirectoryCache(): SessionDirectoryCacheInfo | undefined {
  return currentSettings.sessionDirectoryCache;
}

export function setSessionDirectoryCache(cache: SessionDirectoryCacheInfo): Promise<void> {
  currentSettings.sessionDirectoryCache = cache;
  return writeSettingsFile(currentSettings);
}

export function clearSessionDirectoryCache(): void {
  currentSettings.sessionDirectoryCache = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScheduledTasks(): ScheduledTask[] {
  return [...(currentSettings.scheduledTasks ?? [])];
}

export function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  currentSettings.scheduledTasks = [...tasks];
  return writeSettingsFile(currentSettings);
}

export function __resetSettingsForTests(): void {
  currentSettings = {};
  settingsWriteQueue = Promise.resolve();
}

export async function loadSettings(): Promise<void> {
  const loadedSettings = (await readSettingsFile()) as Settings & {
    toolMessagesIntervalSec?: unknown;
  };

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    void writeSettingsFile(loadedSettings);
  }

  currentSettings = loadedSettings;
}
