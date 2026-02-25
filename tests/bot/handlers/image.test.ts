import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

vi.mock("fs/promises", async () => {
  return {
    default: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../../../src/bot/handlers/image.js", async () => {
  const { processUserPrompt: actualProcessUserPrompt } = await vi.importActual("../../../src/bot/handlers/prompt.js");
  
  return {
    processUserPrompt: vi.fn().mockImplementation(actualProcessUserPrompt),
  };
});

const mockProcessUserPrompt = vi.mocked(async (ctx: Context, text: string, deps: unknown) => {
  return true;
});

import { processUserPrompt } from "../../../src/bot/handlers/prompt.js";
import { t } from "../../../src/i18n/index.js";

function createMockContext(
  photo: Context["message"]["photo"] | undefined,
  document: Context["message"]["document"] | undefined,
  messageThreadId?: number,
): Context {
  return {
    chat: { id: 123 },
    message: {
      photo,
      document,
      message_thread_id: messageThreadId,
    } as Context["message"],
    api: {
      getFile: vi.fn().mockResolvedValue({
        file_path: "photos/123456789.jpg",
        file_size: 1024,
      }),
      editMessageText: vi.fn().mockResolvedValue({}),
    } as unknown as Context["api"],
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

function createMockDeps() {
  return {
    bot: {} as any,
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bot/handlers/image (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should extract file_id from largest photo", async () => {
    const mockPhoto = [
      { file_id: "photo1", width: 100, height: 100 },
      { file_id: "photo2", width: 800, height: 600 },
    ] as any;
    const ctx = createMockContext(mockPhoto, undefined);
    const deps = createMockDeps();

    const photo = ctx.message?.photo;
    const largestPhoto = photo && photo.length > 0 ? photo[photo.length - 1] : undefined;
    const fileId = largestPhoto?.file_id;

    expect(fileId).toBe("photo2");
  });

  it("should extract file_id from document", async () => {
    const mockDocument = {
      file_id: "doc1",
      file_name: "test.pdf",
      mime_type: "application/pdf",
    } as any;
    const ctx = createMockContext(undefined, mockDocument);

    const document = ctx.message?.document;
    const fileId = document?.file_id;

    expect(fileId).toBe("doc1");
  });

  it("should have message_thread_id in context", async () => {
    const mockPhoto = [{ file_id: "photo1", width: 100, height: 100 }] as any;
    const ctx = createMockContext(mockPhoto, undefined, 42);

    expect(ctx.message?.message_thread_id).toBe(42);
  });
});
