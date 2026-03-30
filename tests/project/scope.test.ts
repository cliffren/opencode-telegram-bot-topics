import { beforeEach, describe, expect, it, vi } from "vitest";

type ProjectInfo = { id: string; worktree: string; name?: string };

const settingsStore: {
  currentProject?: ProjectInfo;
  scopedProjects: Record<string, ProjectInfo>;
} = {
  scopedProjects: {},
};

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => settingsStore.currentProject),
  setCurrentProject: vi.fn((project: ProjectInfo) => {
    settingsStore.currentProject = project;
  }),
  getScopedProject: vi.fn((scopeKey: string) => settingsStore.scopedProjects[scopeKey]),
  setScopedProject: vi.fn((scopeKey: string, project: ProjectInfo) => {
    settingsStore.scopedProjects[scopeKey] = project;
  }),
  clearScopedProject: vi.fn((scopeKey: string) => {
    delete settingsStore.scopedProjects[scopeKey];
  }),
}));

describe("project/scope scoped project selection", () => {
  beforeEach(() => {
    settingsStore.currentProject = undefined;
    settingsStore.scopedProjects = {};
    vi.resetModules();
  });

  it("returns scoped project for each topic scope", async () => {
    const { selectProjectForScope, getCurrentProjectForScope } =
      await import("../../src/project/scope.js");

    selectProjectForScope({ id: "project-a", worktree: "/repo/a", name: "A" }, 11, 1001);
    selectProjectForScope({ id: "project-b", worktree: "/repo/b", name: "B" }, 22, 1001);

    expect(getCurrentProjectForScope(11, 1001)).toEqual({
      id: "project-a",
      worktree: "/repo/a",
      name: "A",
    });
    expect(getCurrentProjectForScope(22, 1001)).toEqual({
      id: "project-b",
      worktree: "/repo/b",
      name: "B",
    });
  });

  it("does not leak global project into unrelated scopes", async () => {
    const { getCurrentProjectForScope } = await import("../../src/project/scope.js");

    settingsStore.currentProject = { id: "global", worktree: "/repo/global", name: "Global" };

    expect(getCurrentProjectForScope(99, 2002)).toBeNull();
  });

  it("clears a scoped project without affecting other scopes", async () => {
    const { selectProjectForScope, getCurrentProjectForScope, clearProjectForScope } =
      await import("../../src/project/scope.js");

    selectProjectForScope({ id: "project-a", worktree: "/repo/a" }, 11, 1001);
    selectProjectForScope({ id: "project-b", worktree: "/repo/b" }, 22, 1001);

    clearProjectForScope(11, 1001);

    expect(getCurrentProjectForScope(11, 1001)).toBeNull();
    expect(getCurrentProjectForScope(22, 1001)).toEqual({
      id: "project-b",
      worktree: "/repo/b",
    });
  });
});
