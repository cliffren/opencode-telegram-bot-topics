import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask } from "../../src/schedule/types.js";

const settingsStore: { tasks: ScheduledTask[] } = {
  tasks: [],
};

vi.mock("../../src/settings/manager.js", () => ({
  getScheduledTasks: vi.fn(() => [...settingsStore.tasks]),
  setScheduledTasks: vi.fn(async (tasks: ScheduledTask[]) => {
    settingsStore.tasks = [...tasks];
  }),
}));

describe("schedule/manager", () => {
  beforeEach(() => {
    settingsStore.tasks = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates one-time task from absolute date", async () => {
    const { createScheduledTask, listScheduledTasksByScope } = await import("../../src/schedule/manager.js");

    const task = await createScheduledTask({
      prompt: "Run smoke tests",
      scope: {
        chatId: 1,
        threadId: 10,
        sessionId: "s1",
        sessionTitle: "Session",
        directory: "/tmp/project",
      },
      rule: {
        type: "once",
        runAt: "2026-03-04T12:30:00.000Z",
      },
    });

    expect(task.status).toBe("active");
    expect(task.nextRunAt).toBe("2026-03-04T12:30:00.000Z");
    expect(listScheduledTasksByScope(1, 10)).toHaveLength(1);
  });

  it("computes next run for weekly recurring task", async () => {
    const { computeNextRunAt } = await import("../../src/schedule/manager.js");

    const next = computeNextRunAt(
      {
        type: "recurring_weekly",
        dayOfWeek: 4,
        time: "09:30",
      },
      new Date("2026-03-04T08:00:00.000Z"),
    );

    expect(next).not.toBeNull();
    expect(next?.getDay()).toBe(4);
  });

  it("marks one-time task as completed after successful run", async () => {
    const { createScheduledTask, getDueScheduledTasks, markScheduledTaskRunSuccess, listScheduledTasks } =
      await import("../../src/schedule/manager.js");

    const task = await createScheduledTask({
      prompt: "Ping",
      scope: {
        chatId: 1,
        threadId: null,
        sessionId: "s2",
        sessionTitle: "Session",
        directory: "/tmp/project",
      },
      rule: {
        type: "once",
        runAt: "2026-03-04T12:01:00.000Z",
      },
    });

    vi.setSystemTime(new Date("2026-03-04T12:02:00.000Z"));
    expect(getDueScheduledTasks()).toHaveLength(1);

    await markScheduledTaskRunSuccess(task.id, new Date("2026-03-04T12:02:00.000Z"));

    const updated = listScheduledTasks().find((item) => item.id === task.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.nextRunAt).toBeNull();
    expect(updated?.runCount).toBe(1);
  });
});
