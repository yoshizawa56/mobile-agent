import { describe, expect, it } from "vitest";
import type { WorkspacePickerInput } from "./workspace-picker-viewmodel";
import { workspacePickerState, workspacePickerErrorMessage } from "./workspace-picker-viewmodel";

const workspaces = [
  { id: "workspace-1", name: "mobile-agent", directory: "~/work/mobile-agent", isGit: true, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] },
  { id: "workspace-2", name: "scratch", directory: "~/tmp/scratch", isGit: false, setupScriptPath: null, cleanupScriptPath: null, worktreeCopyPatterns: [] },
];

const baseInput = {
  workspaceCandidates: [],
  browserStatus: "ready" as const,
  browserPath: null,
  registrationOpen: false,
  registrationDirectory: "",
  setupScriptPath: "",
  cleanupScriptPath: "",
  worktreeCopyPatterns: "",
  isRegisteringWorkspace: false,
  registrationError: null,
  errorMessage: null,
};

describe("workspace picker viewmodel", () => {
  it.each([
    {
      name: "waits for directories while loading",
      input: { ...baseInput, workspaces: [], workspaceId: "", mode: "workspace", workspaceStatus: "loading" },
      canContinue: false,
      selectedWorkspace: null,
    },
    {
      name: "allows a selected regular workspace",
      input: { ...baseInput, workspaces, workspaceId: "workspace-2", mode: "workspace", workspaceStatus: "ready" },
      canContinue: true,
      selectedWorkspace: "workspace-2",
    },
    {
      name: "allows a selected workspace worktree",
      input: { ...baseInput, workspaces, workspaceId: "workspace-1", mode: "worktree", workspaceStatus: "ready" },
      canContinue: true,
      selectedWorkspace: "workspace-1",
    },
    {
      name: "disables worktree mode for a non-git directory",
      input: { ...baseInput, workspaces, workspaceId: "workspace-2", mode: "worktree", workspaceStatus: "ready" },
      canContinue: false,
      selectedWorkspace: "workspace-2",
    },
    {
      name: "does not allow a stale workspace id",
      input: { ...baseInput, workspaces, workspaceId: "missing", mode: "workspace", workspaceStatus: "ready" },
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
