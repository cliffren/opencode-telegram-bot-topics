import { PermissionRequest, PermissionState, ScopedPermissionState } from "./types.js";
import { logger } from "../utils/logger.js";

function createEmptyPermissionState(): PermissionState {
  return {
    requestsByMessageId: new Map(),
  };
}

class PermissionManager {
  private state: ScopedPermissionState = {
    scopes: new Map(),
  };

  private resolveScopeKey(scopeKey?: string): string {
    return scopeKey ?? "global";
  }

  private getScopeState(scopeKey?: string): PermissionState {
    return this.state.scopes.get(this.resolveScopeKey(scopeKey)) ?? createEmptyPermissionState();
  }

  private setScopeState(nextState: PermissionState, scopeKey?: string): void {
    this.state.scopes.set(this.resolveScopeKey(scopeKey), nextState);
  }

  startPermission(request: PermissionRequest, messageId: number, scopeKey?: string): void {
    const state = this.getScopeState(scopeKey);
    logger.debug(
      `[PermissionManager] startPermission: id=${request.id}, permission=${request.permission}, messageId=${messageId}, scope=${this.resolveScopeKey(scopeKey)}`,
    );

    if (state.requestsByMessageId.has(messageId)) {
      logger.warn(`[PermissionManager] Message ID already tracked, replacing: ${messageId}`);
    }

    state.requestsByMessageId.set(messageId, request);
    this.setScopeState(state, scopeKey);

    logger.info(
      `[PermissionManager] New permission request: type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${state.requestsByMessageId.size}, scope=${this.resolveScopeKey(scopeKey)}`,
    );
  }

  getRequest(messageId: number | null, scopeKey?: string): PermissionRequest | null {
    if (messageId === null) {
      return null;
    }

    return this.getScopeState(scopeKey).requestsByMessageId.get(messageId) ?? null;
  }

  getRequestID(messageId: number | null, scopeKey?: string): string | null {
    return this.getRequest(messageId, scopeKey)?.id ?? null;
  }

  hasRequestId(requestId: string, scopeKey?: string): boolean {
    for (const request of this.getScopeState(scopeKey).requestsByMessageId.values()) {
      if (request.id === requestId) {
        return true;
      }
    }

    return false;
  }

  getMessageIdByRequestId(requestId: string, scopeKey?: string): number | null {
    for (const [messageId, request] of this.getScopeState(scopeKey).requestsByMessageId.entries()) {
      if (request.id === requestId) {
        return messageId;
      }
    }

    return null;
  }

  getPermissionType(messageId: number | null, scopeKey?: string): string | null {
    return this.getRequest(messageId, scopeKey)?.permission ?? null;
  }

  getPatterns(messageId: number | null, scopeKey?: string): string[] {
    return this.getRequest(messageId, scopeKey)?.patterns ?? [];
  }

  isActiveMessage(messageId: number | null, scopeKey?: string): boolean {
    return messageId !== null && this.getScopeState(scopeKey).requestsByMessageId.has(messageId);
  }

  getMessageId(scopeKey?: string): number | null {
    const messageIds = this.getMessageIds(scopeKey);
    if (messageIds.length === 0) {
      return null;
    }

    return messageIds[messageIds.length - 1];
  }

  getMessageIds(scopeKey?: string): number[] {
    return Array.from(this.getScopeState(scopeKey).requestsByMessageId.keys());
  }

  removeByMessageId(messageId: number | null, scopeKey?: string): PermissionRequest | null {
    const state = this.getScopeState(scopeKey);
    const request = this.getRequest(messageId, scopeKey);
    if (!request || messageId === null) {
      return null;
    }

    state.requestsByMessageId.delete(messageId);
    this.setScopeState(state, scopeKey);

    logger.debug(
      `[PermissionManager] Removed permission request: id=${request.id}, messageId=${messageId}, pending=${state.requestsByMessageId.size}, scope=${this.resolveScopeKey(scopeKey)}`,
    );

    return request;
  }

  getPendingCount(scopeKey?: string): number {
    return this.getScopeState(scopeKey).requestsByMessageId.size;
  }

  isActive(scopeKey?: string): boolean {
    return this.getScopeState(scopeKey).requestsByMessageId.size > 0;
  }

  clear(scopeKey?: string): void {
    const resolvedScopeKey = this.resolveScopeKey(scopeKey);
    const pendingCount = this.getPendingCount(scopeKey);
    logger.debug(
      `[PermissionManager] Clearing permission state: pending=${pendingCount}, scope=${resolvedScopeKey}`,
    );

    this.state.scopes.set(resolvedScopeKey, createEmptyPermissionState());
  }

  clearAll(): void {
    for (const scopeKey of this.state.scopes.keys()) {
      this.clear(scopeKey);
    }
  }
}

export const permissionManager = new PermissionManager();
