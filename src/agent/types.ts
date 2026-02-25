/**
 * Agent information from OpenCode API
 */
export interface AgentInfo {
  name: string;
  description?: string;
  color?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  steps?: number;
}

/**
 * Agent emoji mapping for visual distinction (oh-my-opencode agents + defaults)
 */
export const AGENT_EMOJI: Record<string, string> = {
  plan: "📋",
  build: "🛠️",
  general: "💬",
  explore: "🔍",
  title: "📝",
  summary: "📄",
  compaction: "📦",
  sisyphus: "🔄",
  hephaestus: "🔨",
  oracle: "🔮",
  librarian: "📚",
  atlas: "🗺️",
  prometheus: "🔥",
  metis: "🦉",
  momus: "🎭",
  "multimodal-looker": "👁️",
  "opencode-builder": "🛠️",
  ultrawork: "⚡",
};

function fuzzyMatchAgent(agentName: string): string | undefined {
  const lowerInput = agentName.toLowerCase();
  for (const [key, emoji] of Object.entries(AGENT_EMOJI)) {
    if (lowerInput.includes(key) || key.includes(lowerInput)) {
      return emoji;
    }
  }
  return undefined;
}

/**
 * Get emoji for agent (fallback to 🤖 if not found)
 * Uses fuzzy matching to handle variants like "Sisyphus (Ultraworker)"
 */
export function getAgentEmoji(agentName: string): string {
  const fuzzyEmoji = fuzzyMatchAgent(agentName);
  return fuzzyEmoji ?? "🤖";
}

/**
 * Get display name for agent (with emoji)
 * Extracts base agent name from full string like "Sisyphus (Ultraworker)"
 */
export function getAgentDisplayName(agentName: string): string {
  const emoji = getAgentEmoji(agentName);
  
  // Extract base name: "Sisyphus (Ultraworker)" -> "Sisyphus"
  const baseName = agentName
    .replace(/\s*\(.*\)\s*/, "")
    .replace(/_/g, " ")
    .trim();
  
  const capitalizedName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  return `${emoji} ${capitalizedName} Mode`;
}
