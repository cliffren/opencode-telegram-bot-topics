import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  renameCommand,
  handleRenameCancel,
  handleRenameTextAnswer,
} from "../../../src/bot/commands/rename.js";
import { renameManager } from "../../../src/rename/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentSession: {
    id: "session-1",
    title: "Old title",
    directory: "D:/repo",
  } as { id: string; title: string; directory: string } | null,
  updateSessionMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  setCurrentSessionByThreadMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  scopedSession: null as { id: string; title: string; directory: string } | null,
}));

const RENAME_SCOPE = "101:42";

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      update: mocked.updateSessionMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: mocked.setCurrentSessionMock,
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  getCurrentSessionByThread: vi.fn(() => mocked.scopedSession),
  setCurrentSessionByThread: mocked.setCurrentSessionByThreadMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: vi.fn(() => false),
    onSessionChange: mocked.pinnedOnSessionChangeMock,
  },
}));

function createRenameCommandContext(messageId: number): Context {
  return {
    chat: { id: 101 },
    message: { message_thread_id: 42 } as Context["message"],
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
  } as unknown as Context;
}

function createRenameTextContext(text: string): Context {
  return {
    chat: { id: 101 },
    message: { text, message_thread_id: 42 } as Context["message"],
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createRenameCallbackContext(messageId: number): Context {
  return {
    chat: { id: 101 },
    callbackQuery: {
      data: "rename:cancel",
      message: {
        message_id: messageId,
        message_thread_id: 42,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/rename", () => {
  beforeEach(() => {
    renameManager.clear(RENAME_SCOPE);
    interactionManager.clearAll("test_setup");

    mocked.currentSession = {
      id: "session-1",
      title: "Old title",
      directory: "D:/repo",
    };
    mocked.scopedSession = {
      id: "session-1",
      title: "Old title",
      directory: "D:/repo",
    };
    mocked.updateSessionMock.mockReset();
    mocked.updateSessionMock.mockResolvedValue({
      data: { id: "session-1", title: "New title" },
      error: null,
    });
    mocked.setCurrentSessionMock.mockReset();
    mocked.setCurrentSessionByThreadMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockResolvedValue(undefined);
  });

  it("starts rename flow and interaction state", async () => {
    const ctx = createRenameCommandContext(555);

    await renameCommand(ctx as never);

    expect(renameManager.isWaitingForName(RENAME_SCOPE)).toBe(true);
    expect(renameManager.getMessageId(RENAME_SCOPE)).toBe(555);

    const interactionState = interactionManager.getSnapshot(RENAME_SCOPE);
    expect(interactionState?.kind).toBe("rename");
    expect(interactionState?.expectedInput).toBe("text");
    expect(interactionState?.metadata.sessionId).toBe("session-1");
    expect(interactionState?.metadata.messageId).toBe(555);
  });

  it("prefers scoped session for rename command", async () => {
    mocked.scopedSession = {
      id: "session-scoped",
      title: "Scoped title",
      directory: "D:/scoped",
    };
    const ctx = createRenameCommandContext(556);

    await renameCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("rename.prompt", { title: "Scoped title" }), {
      reply_markup: expect.anything(),
      message_thread_id: 42,
    });
  });

  it("renames session on valid text and clears states", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title", RENAME_SCOPE);
    renameManager.setMessageId(555, RENAME_SCOPE);
    interactionManager.start(
      {
        kind: "rename",
        expectedInput: "text",
        metadata: { sessionId: "session-1", messageId: 555 },
      },
      RENAME_SCOPE,
    );

    const ctx = createRenameTextContext("  New title  ");
    const handled = await handleRenameTextAnswer(ctx);

    expect(handled).toBe(true);
    expect(mocked.updateSessionMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:/repo",
      title: "New title",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "New title",
      directory: "D:/repo",
    });
    expect(mocked.setCurrentSessionByThreadMock).toHaveBeenCalledWith(42, 101);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(101, 555);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.success", { title: "New title" }));
    expect(renameManager.isWaitingForName(RENAME_SCOPE)).toBe(false);
    expect(interactionManager.getSnapshot(RENAME_SCOPE)).toBeNull();
  });

  it("keeps rename flow active on empty title", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title", RENAME_SCOPE);
    renameManager.setMessageId(555, RENAME_SCOPE);
    interactionManager.start(
      {
        kind: "rename",
        expectedInput: "text",
        metadata: { sessionId: "session-1", messageId: 555 },
      },
      RENAME_SCOPE,
    );

    const ctx = createRenameTextContext("   ");
    const handled = await handleRenameTextAnswer(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.empty_title"));
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(renameManager.isWaitingForName(RENAME_SCOPE)).toBe(true);
    expect(interactionManager.getSnapshot(RENAME_SCOPE)?.kind).toBe("rename");
  });

  it("rejects stale rename cancel callback", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title", RENAME_SCOPE);
    renameManager.setMessageId(555, RENAME_SCOPE);
    interactionManager.start(
      {
        kind: "rename",
        expectedInput: "text",
        metadata: { sessionId: "session-1", messageId: 555 },
      },
      RENAME_SCOPE,
    );

    const ctx = createRenameCallbackContext(999);
    const handled = await handleRenameCancel(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("rename.inactive_callback"),
      show_alert: true,
    });
    expect(renameManager.isWaitingForName(RENAME_SCOPE)).toBe(true);
    expect(interactionManager.getSnapshot(RENAME_SCOPE)?.kind).toBe("rename");
  });

  it("cancels active rename and clears states", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title", RENAME_SCOPE);
    renameManager.setMessageId(555, RENAME_SCOPE);
    interactionManager.start(
      {
        kind: "rename",
        expectedInput: "text",
        metadata: { sessionId: "session-1", messageId: 555 },
      },
      RENAME_SCOPE,
    );

    const ctx = createRenameCallbackContext(555);
    const handled = await handleRenameCancel(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("rename.cancelled"));
    expect(renameManager.isWaitingForName(RENAME_SCOPE)).toBe(false);
    expect(interactionManager.getSnapshot(RENAME_SCOPE)).toBeNull();
  });

  it("clears stale rename manager state when interaction is missing", async () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title", RENAME_SCOPE);
    renameManager.setMessageId(555, RENAME_SCOPE);

    const ctx = createRenameTextContext("New title");
    const handled = await handleRenameTextAnswer(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("rename.inactive"));
    expect(mocked.updateSessionMock).not.toHaveBeenCalled();
    expect(renameManager.isWaitingForName(RENAME_SCOPE)).toBe(false);
  });
});
