import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  const module = await import("../src/config.js");
  return module.config;
}

describe("config boolean env parsing", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
  });

  it("uses expected defaults for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(true);
    expect(config.bot.hideToolFileMessages).toBe(true);
  });

  it("parses truthy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "YES");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "1");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "on");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(true);
    expect(config.bot.hideToolCallMessages).toBe(true);
    expect(config.bot.hideToolFileMessages).toBe(true);
  });

  it("parses falsy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "off");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "0");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "false");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
    expect(config.bot.hideToolFileMessages).toBe(false);
  });

  it("falls back to defaults on invalid values", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "banana");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "nope");
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "invalid");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(true);
    expect(config.bot.hideToolFileMessages).toBe(true);
  });
});
