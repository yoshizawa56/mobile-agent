import { describe, expect, it } from "vitest";
import type { WorkspacePickerInput } from "./workspace-picker-viewmodel";
import { workspacePickerState, workspacePickerErrorMessage } from "./workspace-picker-viewmodel";

const workspaces = [
  { id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true },
  { id: "workspace-2", name: "scratch", directory: "~/tmp/scratch", isGit: false },
];
const projects = [{ id: "project-1", name: "mobile-agent", directory: "~/.config/agent/projects/mobile-agent" }];

describe("workspace picker viewmodel", () => {
  it.each([
    {
      name: "waits for directories while loading",
      input: { workspaces: [], projects: [], workspaceId: "", mode: "workspace", projectId: null, workspaceStatus: "loading", projectStatus: "loading", errorMessage: null },
      canContinue: false,
      selectedWorkspace: null,
    },
    {
      name: "allows a selected regular workspace",
      input: { workspaces, projects: [], workspaceId: "workspace-2", mode: "workspace", projectId: null, workspaceStatus: "ready", projectStatus: "ready", errorMessage: null },
      canContinue: true,
      selectedWorkspace: "workspace-2",
    },
    {
      name: "requires a project for a git worktree",
      input: { workspaces, projects, workspaceId: "workspace-1", mode: "worktree", projectId: null, workspaceStatus: "ready", projectStatus: "ready", errorMessage: null },
      canContinue: false,
      selectedWorkspace: "workspace-1",
    },
    {
      name: "allows a selected project worktree",
      input: { workspaces, projects, workspaceId: "workspace-1", mode: "worktree", projectId: "project-1", workspaceStatus: "ready", projectStatus: "ready", errorMessage: null },
      canContinue: true,
      selectedWorkspace: "workspace-1",
    },
    {
      name: "disables worktree mode for a non-git directory",
      input: { workspaces, projects, workspaceId: "workspace-2", mode: "worktree", projectId: "project-1", workspaceStatus: "ready", projectStatus: "ready", errorMessage: null },
      canContinue: false,
      selectedWorkspace: "workspace-2",
    },
    {
      name: "does not allow a stale workspace id",
      input: { workspaces, projects, workspaceId: "missing", mode: "workspace", projectId: null, workspaceStatus: "ready", projectStatus: "ready", errorMessage: null },
      canContinue: false,
      selectedWorkspace: null,
    },
  ] satisfies Array<{ name: string; input: WorkspacePickerInput; canContinue: boolean; selectedWorkspace: string | null }>) ("$name", ({ input, canContinue, selectedWorkspace }) => {
    const state = workspacePickerState(input);
    expect(state.canContinue).toBe(canContinue);
    expect(state.selectedWorkspace?.id ?? null).toBe(selectedWorkspace);
  });

  it.each([
    { value: new Error("workspace service unavailable"), message: "workspace service unavailable" },
    { value: { message: "Directory is outside the allowed workspace roots" }, message: "Directory is outside the allowed workspace roots" },
    { value: null, message: null },
  ])("formats picker errors", ({ value, message }) => {
    expect(workspacePickerErrorMessage(value)).toBe(message);
  });
});
