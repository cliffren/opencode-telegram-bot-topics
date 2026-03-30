import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  scopedPinnedMessageId: 777 as number | undefined,
  setScopedPinnedMessageId: vi.fn(),
  clearScopedPinnedMessageId: vi.fn(),
  setPinnedMessageId: vi.fn(),
  clearPinnedMessageId: vi.fn(),
  providersMock: vi.fn().mockResolvedValue({ data: { providers: [] }, error: null }),
  diffMock: vi.fn().mockResolvedValue({ data: [], error: null }),
  messagesMock: vi.fn().mockResolvedValue({ data: [], error: null }),
  getSessionMock: vi.fn().mockResolvedValue({ data: { title: "Session" }, error: null }),
}));

vi.mock("../../src/settings/manager.js", () => ({
  getScopedPinnedMessageId: vi.fn(() => mocked.scopedPinnedMessageId),
  setScopedPinnedMessageId: mocked.setScopedPinnedMessageId,
  clearScopedPinnedMessageId: mocked.clearScopedPinnedMessageId,
  getPinnedMessageId: vi.fn(() => undefined),
  setPinnedMessageId: mocked.setPinnedMessageId,
  clearPinnedMessageId: mocked.clearPinnedMessageId,
}));

vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "", modelID: "" })),
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => null),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: mocked.providersMock,
    },
    session: {
      diff: mocked.diffMock,
      messages: mocked.messagesMock,
      get: mocked.getSessionMock,
    },
  },
}));

describe("pinned/manager session change behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.scopedPinnedMessageId = 777;
    mocked.setScopedPinnedMessageId.mockReset();
    mocked.clearScopedPinnedMessageId.mockReset();
    mocked.setPinnedMessageId.mockReset();
    mocked.clearPinnedMessageId.mockReset();
    mocked.providersMock.mockClear();
    mocked.diffMock.mockClear();
    mocked.messagesMock.mockClear();
    mocked.getSessionMock.mockClear();
  });

  it("does not recreate pinned message when scope already has one", async () => {
    const { pinnedMessageManager } = await import("../../src/pinned/manager.js");

    const api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
      pinChatMessage: vi.fn().mockResolvedValue(true),
      unpinChatMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    } as any;

    pinnedMessageManager.initialize(api, 1001, 42);

    await pinnedMessageManager.onSessionChange("session-1", "Session One", "/repo/worktree");

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.unpinChatMessage).not.toHaveBeenCalled();
    expect(api.editMessageText).toHaveBeenCalledTimes(1);
  });

  it("recreates pinned message when forced", async () => {
    const { pinnedMessageManager } = await import("../../src/pinned/manager.js");

    const api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 901 }),
      pinChatMessage: vi.fn().mockResolvedValue(true),
      unpinChatMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    } as any;

    pinnedMessageManager.initialize(api, 1001, 42);

    await pinnedMessageManager.onSessionChange("session-2", "Session Two", "/repo/worktree", {
      recreate: true,
    });

    expect(api.unpinChatMessage).toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.pinChatMessage).toHaveBeenCalledTimes(1);
  });
});
