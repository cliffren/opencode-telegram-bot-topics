import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, execMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execMock: vi.fn(),
}));

const { getServerProcessMock, setServerProcessMock, clearServerProcessMock } = vi.hoisted(() => ({
  getServerProcessMock: vi.fn(),
  setServerProcessMock: vi.fn(),
  clearServerProcessMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
  exec: execMock,
}));

vi.mock("../../src/settings/manager.js", () => ({
  getServerProcess: getServerProcessMock,
  setServerProcess: setServerProcessMock,
  clearServerProcess: clearServerProcessMock,
}));

import { processManager } from "../../src/process/manager.js";

const defaultTarget = {
  apiUrl: "http://127.0.0.1:4096",
  port: 4096,
};

function createMockChildProcess(pid: number): ChildProcess {
  const processMock = new EventEmitter() as unknown as ChildProcess;

  Object.assign(processMock, {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn().mockReturnValue(true),
  });

  return processMock;
}

function setPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  };
}

describe("process/manager", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    execMock.mockReset();
    getServerProcessMock.mockReset();
    setServerProcessMock.mockReset();
    clearServerProcessMock.mockReset();

    execMock.mockImplementation((_command: string, callback?: (...args: unknown[]) => void) => {
      if (callback) {
        callback(null, "", "");
      }
      return {};
    });
  });

  it("restores running process from settings on initialize", async () => {
    getServerProcessMock.mockReturnValue({
      pid: 321,
      startTime: new Date(Date.now() - 10_000).toISOString(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => true);

    await processManager.initialize();

    expect(getServerProcessMock).toHaveBeenCalledTimes(1);
    expect(clearServerProcessMock).not.toHaveBeenCalled();
    expect(processManager.isRunning()).toBe(true);
    expect(processManager.getPID()).toBe(321);
    expect(processManager.getUptime()).toBeTypeOf("number");
  });

  it("cleans dead saved process on initialize", async () => {
    getServerProcessMock.mockReturnValue({
      pid: 322,
      startTime: new Date().toISOString(),
    });
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });

    await processManager.initialize();

    expect(clearServerProcessMock).toHaveBeenCalledTimes(1);
    expect(processManager.isRunning()).toBe(false);
    expect(processManager.getPID()).toBeNull();
  });

  it("starts process and persists PID", async () => {
    const restorePlatform = setPlatform("win32");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    spawnMock.mockReturnValue(createMockChildProcess(456));

    try {
      const result = await processManager.start(defaultTarget);

      expect(result).toEqual({ success: true });
      expect(spawnMock).toHaveBeenCalledWith(
        "cmd.exe",
        ["/c", "opencode", "serve", "--port", "4096"],
        expect.objectContaining({
          detached: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
      expect(setServerProcessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: 456,
          startTime: expect.any(String),
          apiUrl: defaultTarget.apiUrl,
          port: defaultTarget.port,
        }),
      );
      expect(processManager.getPID()).toBe(456);
      expect(processManager.isRunning()).toBe(true);

      const alreadyRunning = await processManager.start(defaultTarget);
      expect(alreadyRunning).toEqual({ success: false, error: "Process already running" });
    } finally {
      restorePlatform();
    }
  });

  it("returns error when process fails to start", async () => {
    const restorePlatform = setPlatform("win32");
    spawnMock.mockReturnValue(createMockChildProcess(undefined as never));

    try {
      const result = await processManager.start(defaultTarget);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to start OpenCode server process");
      expect(processManager.getPID()).toBeNull();
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("stops running process on Windows and clears state", async () => {
    const restorePlatform = setPlatform("win32");
    spawnMock.mockReturnValue(createMockChildProcess(789));
    vi.spyOn(process, "kill").mockImplementation(() => true);

    try {
      await processManager.start(defaultTarget);
      const result = await processManager.stop(100);

      expect(result).toEqual({ success: true });
      expect(execMock).toHaveBeenCalledTimes(1);
      expect(execMock.mock.calls[0][0]).toBe("taskkill /F /T /PID 789");
      expect(processManager.getPID()).toBeNull();
      expect(processManager.isRunning()).toBe(false);
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("returns error when stopping non-running process", async () => {
    const result = await processManager.stop();
    expect(result).toEqual({ success: false, error: "Process not running" });
  });

  it("cleans up state when tracked process is no longer alive", async () => {
    const restorePlatform = setPlatform("win32");
    spawnMock.mockReturnValue(createMockChildProcess(999));

    try {
      await processManager.start(defaultTarget);
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

      expect(processManager.isRunning()).toBe(false);
      expect(processManager.getPID()).toBeNull();
      expect(clearServerProcessMock).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
});
