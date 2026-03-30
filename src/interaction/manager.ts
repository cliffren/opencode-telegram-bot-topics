import type {
  InteractionClearReason,
  InteractionState,
  StartInteractionOptions,
  TransitionInteractionOptions,
} from "./types.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_ALLOWED_INTERACTION_COMMANDS = ["/help", "/status", "/stop"] as const;

function normalizeCommand(command: string): string | null {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutMention = withSlash.split("@")[0];

  if (withoutMention.length <= 1) {
    return null;
  }

  return withoutMention;
}

function normalizeAllowedCommands(commands?: string[]): string[] {
  if (commands === undefined) {
    return [...DEFAULT_ALLOWED_INTERACTION_COMMANDS];
  }

  const normalized = new Set<string>();

  for (const command of commands) {
    const value = normalizeCommand(command);
    if (value) {
      normalized.add(value);
    }
  }

  return Array.from(normalized);
}

function cloneState(state: InteractionState): InteractionState {
  return {
    ...state,
    allowedCommands: [...state.allowedCommands],
    metadata: { ...state.metadata },
  };
}

class InteractionManager {
  private states = new Map<string, InteractionState>();

  private resolveScopeKey(scopeKey?: string): string {
    return scopeKey ?? "global";
  }

  start(options: StartInteractionOptions, scopeKey?: string): InteractionState {
    const now = Date.now();
    let expiresAt: number | null = null;
    const key = this.resolveScopeKey(scopeKey);

    if (this.states.has(key)) {
      this.clear("state_replaced", key);
    }

    if (typeof options.expiresInMs === "number") {
      expiresAt = now + options.expiresInMs;
    }

    const nextState: InteractionState = {
      kind: options.kind,
      expectedInput: options.expectedInput,
      allowedCommands: normalizeAllowedCommands(options.allowedCommands),
      metadata: options.metadata ? { ...options.metadata } : {},
      createdAt: now,
      expiresAt,
    };

    this.states.set(key, nextState);

    logger.info(
      `[InteractionManager] Started interaction: kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(nextState);
  }

  get(scopeKey?: string): InteractionState | null {
    const state = this.states.get(this.resolveScopeKey(scopeKey)) ?? null;
    if (!state) {
      return null;
    }

    return cloneState(state);
  }

  getSnapshot(scopeKey?: string): InteractionState | null {
    return this.get(scopeKey);
  }

  isActive(scopeKey?: string): boolean {
    return this.states.has(this.resolveScopeKey(scopeKey));
  }

  isExpired(referenceTimeMs: number = Date.now(), scopeKey?: string): boolean {
    const state = this.states.get(this.resolveScopeKey(scopeKey)) ?? null;
    if (!state || state.expiresAt === null) {
      return false;
    }

    return referenceTimeMs >= state.expiresAt;
  }

  transition(options: TransitionInteractionOptions, scopeKey?: string): InteractionState | null {
    const key = this.resolveScopeKey(scopeKey);
    const currentState = this.states.get(key) ?? null;
    if (!currentState) {
      return null;
    }

    const now = Date.now();

    const nextState = {
      ...currentState,
      kind: options.kind ?? currentState.kind,
      expectedInput: options.expectedInput ?? currentState.expectedInput,
      allowedCommands:
        options.allowedCommands !== undefined
          ? normalizeAllowedCommands(options.allowedCommands)
          : [...currentState.allowedCommands],
      metadata: options.metadata ? { ...options.metadata } : { ...currentState.metadata },
      expiresAt:
        options.expiresInMs === undefined
          ? currentState.expiresAt
          : options.expiresInMs === null
            ? null
            : now + options.expiresInMs,
    };
    this.states.set(key, nextState);

    logger.debug(
      `[InteractionManager] Transitioned interaction: kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(nextState);
  }

  clear(reason: InteractionClearReason = "manual", scopeKey?: string): void {
    const key = this.resolveScopeKey(scopeKey);
    const state = this.states.get(key) ?? null;
    if (!state) {
      return;
    }

    logger.info(
      `[InteractionManager] Cleared interaction: reason=${reason}, kind=${state.kind}, expectedInput=${state.expectedInput}`,
    );

    this.states.delete(key);
  }

  clearAll(reason: InteractionClearReason = "manual"): void {
    for (const key of this.states.keys()) {
      this.clear(reason, key);
    }
  }
}

export const interactionManager = new InteractionManager();
