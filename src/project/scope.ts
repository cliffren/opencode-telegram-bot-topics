import {
  clearScopedProject,
  getCurrentProject,
  getScopedProject,
  setCurrentProject,
  setScopedProject,
} from "../settings/manager.js";
import type { ProjectInfo } from "../settings/manager.js";

export function getProjectScopeKey(chatId: number | null, threadId: number | null): string {
  return `${chatId ?? "none"}:${threadId ?? "private"}`;
}

export function getCurrentProjectForScope(
  threadId: number | null,
  chatId: number | null,
): ProjectInfo | null {
  if (threadId === null && chatId === null) {
    return getCurrentProject() ?? null;
  }

  return getScopedProject(getProjectScopeKey(chatId, threadId)) ?? null;
}

export function selectProjectForScope(
  projectInfo: ProjectInfo,
  threadId: number | null,
  chatId: number | null,
): void {
  setScopedProject(getProjectScopeKey(chatId, threadId), projectInfo);
  setCurrentProject(projectInfo);
}

export function clearProjectForScope(threadId: number | null, chatId: number | null): void {
  clearScopedProject(getProjectScopeKey(chatId, threadId));
}
