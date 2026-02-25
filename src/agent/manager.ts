import { opencodeClient } from "../opencode/client.js";
import { getCurrentProject } from "../settings/manager.js";
import { getCurrentSession } from "../session/manager.js";
import {
  getCurrentAgent,
  getScopedAgent,
  setCurrentAgent,
  setScopedAgent,
} from "../settings/manager.js";
import { logger } from "../utils/logger.js";
import type { AgentInfo } from "./types.js";

export function getAgentScopeKey(chatId: number | null, threadId: number | null): string {
  return `${chatId ?? "none"}:${threadId ?? "private"}`;
}

/**
 * Get list of available agents from OpenCode API
 * @returns Array of available agents (filtered by mode and hidden flag)
 */
export async function getAvailableAgents(): Promise<AgentInfo[]> {
  const project = getCurrentProject();
  if (!project) {
    logger.warn("[AgentManager] Cannot get agents: no project selected");
    return [];
  }

  try {
    const { data: agents, error } = await opencodeClient.app.agents({
      directory: project.worktree,
    });

    if (error) {
      logger.error("[AgentManager] Failed to fetch agents:", error);
      return [];
    }

    if (!agents) {
      return [];
    }

    // Filter out hidden agents and subagents (only show primary and all)
    const filtered = agents.filter(
      (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
    );

    logger.debug(`[AgentManager] Fetched ${filtered.length} available agents`);
    return filtered;
  } catch (err) {
    logger.error("[AgentManager] Error fetching agents:", err);
    return [];
  }
}

/**
 * Get current agent from last session message or settings
 * @returns Current agent name or undefined
 */
export async function fetchCurrentAgent(
  threadId: number | null = null,
  chatId: number | null = null,
): Promise<string | undefined> {
  const scopedAgent = getScopedAgent(getAgentScopeKey(chatId, threadId));
  const storedAgent = scopedAgent ?? getCurrentAgent();
  const session = getCurrentSession();
  const project = getCurrentProject();

  if (!session || !project) {
    // No active session, return stored agent from settings
    return storedAgent;
  }

  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: session.id,
      directory: project.worktree,
      limit: 1,
    });

    if (error || !messages || messages.length === 0) {
      logger.debug("[AgentManager] No messages found, using stored agent");
      return storedAgent;
    }

    const lastAgent = messages[0].info.agent;
    logger.debug(`[AgentManager] Current agent from session: ${lastAgent}`);

    // If user explicitly selected an agent in bot settings, prefer it.
    // Session messages may contain stale agent until next prompt is sent.
    if (storedAgent && lastAgent !== storedAgent) {
      logger.debug(
        `[AgentManager] Using stored agent "${storedAgent}" instead of session agent "${lastAgent}"`,
      );
      return storedAgent;
    }

    // No stored agent yet: sync from session history
    if (lastAgent && lastAgent !== storedAgent) {
      if (chatId !== null || threadId !== null) {
        setScopedAgent(getAgentScopeKey(chatId, threadId), lastAgent);
      }
      setCurrentAgent(lastAgent);
    }

    return lastAgent || storedAgent;
  } catch (err) {
    logger.error("[AgentManager] Error fetching current agent:", err);
    return storedAgent;
  }
}

/**
 * Select agent and persist to settings
 * @param agentName Name of the agent to select
 */
export function selectAgent(agentName: string): void {
  logger.info(`[AgentManager] Selected agent (global): ${agentName}`);
  setCurrentAgent(agentName);
}

export function selectAgentForScope(
  agentName: string,
  threadId: number | null,
  chatId: number | null,
): void {
  const scopeKey = getAgentScopeKey(chatId, threadId);
  logger.info(`[AgentManager] Selected scoped agent for ${scopeKey}: ${agentName}`);
  setScopedAgent(scopeKey, agentName);
  setCurrentAgent(agentName);
}

/**
 * Get stored agent from settings (synchronous)
 * @returns Current agent name or default "build"
 */
export function getStoredAgent(threadId: number | null = null, chatId: number | null = null): string {
  const scopedAgent = getScopedAgent(getAgentScopeKey(chatId, threadId));
  if (scopedAgent) {
    return scopedAgent;
  }

  return getCurrentAgent() ?? "build";
}
