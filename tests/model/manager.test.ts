import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsStore: {
  currentModel?: { providerID: string; modelID: string; variant?: string };
  scopedModels: Record<string, { providerID: string; modelID: string; variant?: string }>;
} = {
  scopedModels: {},
};

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentModel: vi.fn(() => settingsStore.currentModel),
  setCurrentModel: vi.fn((model: { providerID: string; modelID: string; variant?: string }) => {
    settingsStore.currentModel = model;
  }),
  getScopedModel: vi.fn((scopeKey: string) => settingsStore.scopedModels[scopeKey]),
  setScopedModel: vi.fn((scopeKey: string, model: { providerID: string; modelID: string; variant?: string }) => {
    settingsStore.scopedModels[scopeKey] = model;
  }),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      model: {
        provider: "openai",
        modelId: "gpt-5",
      },
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

describe("model/manager scoped model selection", () => {
  beforeEach(() => {
    settingsStore.currentModel = undefined;
    settingsStore.scopedModels = {};
    vi.resetModules();
  });

  it("returns scoped model for the active topic scope", async () => {
    const { selectModelForScope, getStoredModel } = await import("../../src/model/manager.js");

    selectModelForScope({ providerID: "anthropic", modelID: "claude-sonnet", variant: "default" }, 11, 1001);
    selectModelForScope({ providerID: "openai", modelID: "gpt-5", variant: "high" }, 22, 1001);

    expect(getStoredModel(11, 1001)).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet",
      variant: "default",
    });
    expect(getStoredModel(22, 1001)).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "high",
    });
  });

  it("falls back to global/default model when scope has no override", async () => {
    const { getStoredModel } = await import("../../src/model/manager.js");

    settingsStore.currentModel = { providerID: "xai", modelID: "grok-4", variant: "default" };
    expect(getStoredModel(99, 2002)).toEqual({
      providerID: "xai",
      modelID: "grok-4",
      variant: "default",
    });
  });
});
