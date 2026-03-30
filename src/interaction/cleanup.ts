import { permissionManager } from "../permission/manager.js";
import { questionManager } from "../question/manager.js";
import { renameManager } from "../rename/manager.js";
import { interactionManager } from "./manager.js";
import { logger } from "../utils/logger.js";

export function clearAllInteractionState(reason: string, scopeKey?: string): void {
  const questionActive = questionManager.isActive(scopeKey);
  const permissionActive = permissionManager.isActive(scopeKey);
  const renameActive = renameManager.isWaitingForName(scopeKey);
  const interactionSnapshot = scopeKey
    ? interactionManager.getSnapshot(scopeKey)
    : interactionManager.getSnapshot();

  if (scopeKey) {
    questionManager.clear(scopeKey);
    permissionManager.clear(scopeKey);
    renameManager.clear(scopeKey);
    interactionManager.clear(reason, scopeKey);
  } else {
    questionManager.clear();
    permissionManager.clearAll();
    renameManager.clear();
    interactionManager.clearAll(reason);
  }

  const hasAnyActiveState =
    questionActive || permissionActive || renameActive || interactionSnapshot !== null;

  const message =
    `[InteractionCleanup] Cleared state: reason=${reason}, ` +
    `scope=${scopeKey ?? "all"}, ` +
    `questionActive=${questionActive}, permissionActive=${permissionActive}, ` +
    `renameActive=${renameActive}, interactionKind=${interactionSnapshot?.kind || "none"}`;

  if (hasAnyActiveState) {
    logger.info(message);
    return;
  }

  logger.debug(message);
}
