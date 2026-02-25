import { beforeEach, describe, expect, it, vi } from "vitest";

type SessionInfo = { id: string; title: string; directory: string };

let currentSession: SessionInfo | null = null;
let scopedSessions: Record<string, SessionInfo> = {};

vi.mock("../../../src/session/manager.js", async () => {
  const actual = await vi.importActual<object>("../../../src/session/manager.js");
  return {
    ...actual,
    getCurrentSession: vi.fn(() => currentSession),
  };
});

vi.mock("../../../src/settings/manager.js", async () => {
  const actual = await vi.importActual<object>("../../../src/settings/manager.js");
  return {
    ...actual,
    getScopedSession: vi.fn((scopeKey: string) => scopedSessions[scopeKey]),
    setScopedSession: vi.fn((scopeKey: string, sessionInfo: SessionInfo) => {
      scopedSessions[scopeKey] = sessionInfo;
    }),
    clearScopedSession: vi.fn((scopeKey: string) => {
      delete scopedSessions[scopeKey];
    }),
  };
});

describe("bot/handlers/prompt thread session mapping", () => {
  beforeEach(() => {
    currentSession = null;
    scopedSessions = {};
    vi.resetModules();
  });

  it("stores and returns per-chat+thread session", async () => {
    currentSession = { id: "ses_1", title: "Thread 1", directory: "/tmp/project" };

    const { setCurrentSessionByThread, getCurrentSessionByThread } = await import(
      "../../../src/bot/handlers/prompt.js"
    );

    setCurrentSessionByThread(42, 1001);

    expect(getCurrentSessionByThread(42, 1001)).toEqual(currentSession);
    expect(getCurrentSessionByThread(42, 2002)).toBeNull();
    expect(getCurrentSessionByThread(99, 1001)).toBeNull();
  });

  it("stores and returns private chat-scoped session", async () => {
    currentSession = { id: "ses_private", title: "Private", directory: "/tmp/project" };

    const { setCurrentSessionByThread, getCurrentSessionByThread } = await import(
      "../../../src/bot/handlers/prompt.js"
    );

    setCurrentSessionByThread(null, 3003);

    expect(getCurrentSessionByThread(null, 3003)).toEqual(currentSession);
    expect(getCurrentSessionByThread(null, 4004)).toBeNull();
  });

  it("clears a thread mapping", async () => {
    currentSession = { id: "ses_2", title: "Thread 2", directory: "/tmp/project" };

    const { setCurrentSessionByThread, getCurrentSessionByThread, clearSessionByThread } =
      await import("../../../src/bot/handlers/prompt.js");

    setCurrentSessionByThread(7, 1001);
    expect(getCurrentSessionByThread(7, 1001)).toEqual(currentSession);

    clearSessionByThread(7, 1001);
    expect(getCurrentSessionByThread(7, 1001)).toBeNull();
  });

  it("restores mapping from persisted scoped sessions after restart", async () => {
    scopedSessions["1001:42"] = { id: "ses_persisted", title: "Persisted", directory: "/tmp/project" };

    const { getCurrentSessionByThread } = await import("../../../src/bot/handlers/prompt.js");

    expect(getCurrentSessionByThread(42, 1001)).toEqual(scopedSessions["1001:42"]);
  });
});
