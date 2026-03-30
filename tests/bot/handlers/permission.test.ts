import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import type { PermissionRequest } from "../../../src/permission/types.js";
import { permissionManager } from "../../../src/permission/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import {
  showPermissionRequest,
  handlePermissionCallback,
} from "../../../src/bot/handlers/permission.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  permissionReplyMock: vi.fn(),
  currentProject: {
    id: "project-1",
    worktree: "D:/repo",
  } as { id: string; worktree: string } | undefined,
  currentSession: null as { id: string; title: string; directory: string } | null,
  scopedProject: null as { id: string; worktree: string } | null,
  scopedSession: null as { id: string; title: string; directory: string } | null,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    permission: {
      reply: mocked.permissionReplyMock,
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/project/scope.js", () => ({
  getCurrentProjectForScope: vi.fn(() => mocked.scopedProject),
}));

vi.mock("../../../src/bot/handlers/prompt.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/bot/handlers/prompt.js")>(
    "../../../src/bot/handlers/prompt.js",
  );

  return {
    ...actual,
    getCurrentSessionByThread: vi.fn(() => mocked.scopedSession),
    getPromptThreadId: vi.fn(() => null),
  };
});

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: ({
    task,
    onSuccess,
    onError,
  }: {
    task: () => Promise<unknown>;
    onSuccess?: (value: unknown) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }) => {
    void task()
      .then((result) => {
        if (onSuccess) {
          void onSuccess(result);
        }
      })
      .catch((error) => {
        if (onError) {
          void onError(error);
        }
      });
  },
}));

function createPermissionRequest(id: string): PermissionRequest {
  return {
    id,
    sessionID: "session-1",
    permission: "bash",
    patterns: ["npm test"],
    metadata: {},
    always: [],
  };
}

function createBotApi(messageId: number = 500): Context["api"] {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: messageId }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createPermissionCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Context;
}

function getCallbackData(button: unknown): string | undefined {
  if (!button || typeof button !== "object") {
    return undefined;
  }

  const maybeButton = button as { callback_data?: string };
  return maybeButton.callback_data;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("bot/handlers/permission", () => {
  const permissionScope = "777:private";

  beforeEach(() => {
    permissionManager.clear();
    interactionManager.clearAll("test_setup");

    mocked.permissionReplyMock.mockReset();
    mocked.permissionReplyMock.mockResolvedValue({ error: null });

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:/repo",
    };
    mocked.currentSession = null;
    mocked.scopedProject = null;
    mocked.scopedSession = null;
  });

  it("starts permission interaction and stores message id", async () => {
    const botApi = createBotApi(500);
    const request = createPermissionRequest("perm-1");

    await showPermissionRequest(botApi, 777, request);

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const [, , options] = sendMessageMock.mock.calls[0];
    const replyMarkup = (options as { reply_markup: InlineKeyboard }).reply_markup;

    expect(replyMarkup.inline_keyboard).toHaveLength(3);
    expect(replyMarkup.inline_keyboard[0]?.[0]?.text).toBe(t("permission.button.allow"));
    expect(getCallbackData(replyMarkup.inline_keyboard[0]?.[0])).toBe("permission:once");
    expect(replyMarkup.inline_keyboard[1]?.[0]?.text).toBe(t("permission.button.always"));
    expect(getCallbackData(replyMarkup.inline_keyboard[1]?.[0])).toBe("permission:always");
    expect(replyMarkup.inline_keyboard[2]?.[0]?.text).toBe(t("permission.button.reject"));
    expect(getCallbackData(replyMarkup.inline_keyboard[2]?.[0])).toBe("permission:reject");

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getRequestID(500)).toBe("perm-1");
    expect(permissionManager.getMessageId()).toBe(500);
    expect(permissionManager.getPendingCount()).toBe(1);

    const state = interactionManager.getSnapshot(permissionScope);
    expect(state?.kind).toBe("permission");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("perm-1");
    expect(state?.metadata.messageId).toBe(500);
  });

  it("escapes unknown permission names for Markdown", async () => {
    const botApi = createBotApi(510);
    const request: PermissionRequest = {
      ...createPermissionRequest("perm-external"),
      permission: "external_directory",
      patterns: ["/Users/rentao/Projects"],
    };

    await showPermissionRequest(botApi, 777, request);

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const [, text, options] = sendMessageMock.mock.calls[0] as [
      number,
      string,
      { parse_mode: string },
    ];

    expect(text).toContain("external\\_directory");
    expect(options.parse_mode).toBe("Markdown");
  });

  it("keeps multiple active permission requests without deleting previous messages", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const deleteMessageMock = botApi.deleteMessage as unknown as ReturnType<typeof vi.fn>;
    expect(deleteMessageMock).not.toHaveBeenCalled();

    expect(permissionManager.getRequestID(500)).toBe("perm-1");
    expect(permissionManager.getRequestID(501)).toBe("perm-2");
    expect(permissionManager.getMessageId()).toBe(501);
    expect(permissionManager.getMessageIds()).toEqual([500, 501]);
    expect(permissionManager.getPendingCount()).toBe(2);

    const state = interactionManager.getSnapshot(permissionScope);
    expect(state?.kind).toBe("permission");
    expect(state?.metadata.requestID).toBe("perm-2");
    expect(state?.metadata.messageId).toBe(501);
    expect(state?.metadata.pendingCount).toBe(2);
  });

  it("ignores duplicate permission request with same request id", async () => {
    const botApi = createBotApi(800);
    const request = createPermissionRequest("perm-dup");

    await showPermissionRequest(botApi, 777, request);
    await showPermissionRequest(botApi, 777, request);

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(permissionManager.getPendingCount()).toBe(1);
    expect(permissionManager.getRequestID(800)).toBe("perm-dup");
  });

  it("ignores duplicate permission request while first send is in-flight", async () => {
    let resolveFirstSend!: (value: { message_id: number }) => void;

    const sendMessageMock = vi.fn().mockImplementation(
      () =>
        new Promise<{ message_id: number }>((resolve) => {
          resolveFirstSend = resolve;
        }),
    );
    const botApi = {
      sendMessage: sendMessageMock,
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];
    const request = createPermissionRequest("perm-inflight");

    const firstCall = showPermissionRequest(botApi, 777, request);
    const secondCall = showPermissionRequest(botApi, 777, request);

    await Promise.resolve();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    resolveFirstSend({ message_id: 801 });
    await firstCall;
    await secondCall;

    expect(permissionManager.getPendingCount()).toBe(1);
    expect(permissionManager.getRequestID(801)).toBe("perm-inflight");
  });

  it("rejects callback from unknown permission message", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const staleCtx = createPermissionCallbackContext("permission:once", 499);
    const handled = await handlePermissionCallback(staleCtx);

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("permission.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.permissionReplyMock).not.toHaveBeenCalled();

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getPendingCount()).toBe(2);
    expect(permissionManager.getRequestID(501)).toBe("perm-2");
  });

  it("handles valid permission reply and clears active states", async () => {
    const botApi = createBotApi(600);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-valid"));

    mocked.scopedProject = { id: "project-1", worktree: "D:/repo" };
    mocked.scopedSession = { id: "session-1", title: "Scoped", directory: "D:/repo" };

    const ctx = createPermissionCallbackContext("permission:always", 600);
    const handled = await handlePermissionCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.always") });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-valid",
      directory: "D:/repo",
      reply: "always",
    });

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot(permissionScope)).toBeNull();
  });

  it("uses scope-specific session directory for permission reply", async () => {
    const botApi = createBotApi(610);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-scoped"));

    mocked.currentProject = {
      id: "project-global",
      worktree: "D:/wrong-project",
    };
    mocked.currentSession = null;
    mocked.scopedProject = {
      id: "project-scoped",
      worktree: "D:/scoped-project",
    };
    mocked.scopedSession = {
      id: "session-scoped",
      title: "Scoped",
      directory: "D:/scoped-session",
    };

    const ctx = {
      ...createPermissionCallbackContext("permission:once", 610),
      callbackQuery: {
        data: "permission:once",
        message: {
          message_id: 610,
          message_thread_id: 42,
        },
      } as Context["callbackQuery"],
    } as Context;

    const handled = await handlePermissionCallback(ctx);

    expect(handled).toBe(true);

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-scoped",
      directory: "D:/scoped-session",
      reply: "once",
    });
  });

  it("keeps permission interaction active until all requests are replied", async () => {
    const botApi = createBotApi(700);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 701 });
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    mocked.scopedProject = { id: "project-1", worktree: "D:/repo" };
    mocked.scopedSession = { id: "session-1", title: "Scoped", directory: "D:/repo" };

    const firstCtx = createPermissionCallbackContext("permission:once", 700);
    const firstHandled = await handlePermissionCallback(firstCtx);

    expect(firstHandled).toBe(true);
    expect(firstCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.once") });

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-1",
      directory: "D:/repo",
      reply: "once",
    });

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getPendingCount()).toBe(1);
    expect(permissionManager.getRequestID(701)).toBe("perm-2");

    const stateAfterFirstReply = interactionManager.getSnapshot(permissionScope);
    expect(stateAfterFirstReply?.kind).toBe("permission");
    expect(stateAfterFirstReply?.expectedInput).toBe("callback");
    expect(stateAfterFirstReply?.metadata.pendingCount).toBe(1);

    const secondCtx = createPermissionCallbackContext("permission:reject", 701);
    const secondHandled = await handlePermissionCallback(secondCtx);

    expect(secondHandled).toBe(true);
    expect(secondCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("permission.reply.reject"),
    });

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-2",
      directory: "D:/repo",
      reply: "reject",
    });

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot(permissionScope)).toBeNull();
  });

  it("clears states when permission message cannot be sent", async () => {
    const botApi = {
      sendMessage: vi.fn().mockRejectedValue(new Error("send failed")),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    await expect(
      showPermissionRequest(botApi, 777, createPermissionRequest("perm-fail")),
    ).rejects.toThrow("send failed");

    expect(botApi.sendMessage).toHaveBeenCalledTimes(2);

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot(permissionScope)).toBeNull();
  });

  it("retries permission message send once after transient failure", async () => {
    const botApi = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary send error"))
        .mockResolvedValueOnce({ message_id: 900 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-retry"));

    expect(botApi.sendMessage).toHaveBeenCalledTimes(2);
    expect(permissionManager.getPendingCount()).toBe(1);
    expect(permissionManager.getRequestID(900)).toBe("perm-retry");
  });
});
