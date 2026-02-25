import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsStore: {
  currentAgent?: string;
  scopedAgents: Record<string, string>;
} = {
  scopedAgents: {},
};

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => undefined),
  getCurrentAgent: vi.fn(() => settingsStore.currentAgent),
  setCurrentAgent: vi.fn((agentName: string) => {
    settingsStore.currentAgent = agentName;
  }),
  getScopedAgent: vi.fn((scopeKey: string) => settingsStore.scopedAgents[scopeKey]),
  setScopedAgent: vi.fn((scopeKey: string, agentName: string) => {
    settingsStore.scopedAgents[scopeKey] = agentName;
  }),
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => undefined),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    app: {
      agents: vi.fn(async () => ({ data: [], error: undefined })),
    },
    session: {
      messages: vi.fn(async () => ({ data: [], error: undefined })),
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("agent/manager scoped agent selection", () => {
  beforeEach(() => {
    settingsStore.currentAgent = undefined;
    settingsStore.scopedAgents = {};
    vi.resetModules();
  });

  it("returns scoped agent for each topic scope", async () => {
    const { selectAgentForScope, getStoredAgent } = await import("../../src/agent/manager.js");

    selectAgentForScope("plan", 11, 1001);
    selectAgentForScope("build", 22, 1001);

    expect(getStoredAgent(11, 1001)).toBe("plan");
    expect(getStoredAgent(22, 1001)).toBe("build");
  });

  it("falls back to global agent when scope has no override", async () => {
    const { getStoredAgent } = await import("../../src/agent/manager.js");

    settingsStore.currentAgent = "plan";
    expect(getStoredAgent(99, 2002)).toBe("plan");
  });
});
