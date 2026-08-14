import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasError,
  hasObserved,
  noFixture,
  returns,
  runOperationTable,
  runScenarioTable,
  type Assertion,
  type FixtureHandle,
  type OperationCase,
  type OperationTable,
  type ScenarioCase,
  type ScenarioTable,
  type TestRegistrar,
} from "@mobile-agent/test-support";
import { AllowedRootPolicy, WorkspaceSelectionCatalog, allowedRootsFromEnvironment } from "./workspace-selection.js";

type EmptyContext = {};
type RootsInput = { env: NodeJS.ProcessEnv; fallback: string };
const rootsCases = [
  { name: "reads the documented workspace roots variable", input: { env: { AGENTD_WORKSPACE_ROOTS: "/work:/projects" }, fallback: "/agentd" }, assert: [returns<EmptyContext, string[]>(["/work", "/projects"])] },
  { name: "supports the compatibility roots variable", input: { env: { AGENTD_ALLOWED_ROOTS: "/scratch" }, fallback: "/agentd" }, assert: [returns<EmptyContext, string[]>(["/scratch"])] },
  { name: "falls back to the daemon working directory", input: { env: {}, fallback: "/agentd" }, assert: [returns<EmptyContext, string[]>(["/agentd"])] },
] satisfies readonly OperationCase<"default", RootsInput, string[], EmptyContext>[];

const rootsTable: OperationTable<undefined, "default", RootsInput, string[], EmptyContext> = {
  defaultFixture: noFixture(),
  cases: rootsCases,
  execute: (_fixture, input) => allowedRootsFromEnvironment(input.env, input.fallback),
  observe: () => ({}),
};

type PolicyFixture = { root: string; outside: string; file: string; policy: AllowedRootPolicy; actualPath: string | null; expectedPath: string | null };
type PolicyInput = { candidate: "root" | "child" | "outside" | "missing" | "file" };
const policyFixture = (): FixtureHandle<PolicyFixture> => {
  const root = mkdtempSync(join(tmpdir(), "mobile-agent-policy-"));
  const outside = mkdtempSync(join(tmpdir(), "mobile-agent-outside-"));
  const child = join(root, "project");
  mkdirSync(child);
  const file = join(root, "README");
  writeFileSync(file, "fixture\n");
  return { fixture: { root, outside, file, policy: new AllowedRootPolicy([root]), actualPath: null, expectedPath: null }, cleanup: () => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); } };
};

const policyCases = [
  { name: "accepts the configured root", input: { candidate: "root" }, assert: [hasResolvedPath()] },
  { name: "accepts a directory below the configured root", input: { candidate: "child" }, assert: [hasResolvedPath()] },
  { name: "rejects a path outside the configured root", input: { candidate: "outside" }, assert: [hasError<PolicyContext, string>({ code: "invalid_directory", reason: "outside_allowed_root" })] },
  { name: "rejects a missing directory", input: { candidate: "missing" }, assert: [hasError<PolicyContext, string>({ code: "invalid_directory", reason: "not_found" })] },
  { name: "rejects a regular file", input: { candidate: "file" }, assert: [hasError<PolicyContext, string>({ code: "invalid_directory", reason: "not_directory" })] },
] satisfies readonly OperationCase<"default", PolicyInput, string, PolicyContext>[];

type PolicyContext = { actualPath: string | null; expectedPath: string | null };
function hasResolvedPath(): Assertion<PolicyContext, string> {
  return {
    name: "resolves to the canonical directory path",
    check: (ctx, result) => {
      if (!result.ok) throw result.error;
      expect(result.value).toBe(ctx.expectedPath);
    },
  };
}

const policyTable: OperationTable<PolicyFixture, "default", PolicyInput, string, PolicyContext> = {
  defaultFixture: policyFixture,
  cases: policyCases,
  execute: (fixture, input) => {
    const candidate = input.candidate === "root" ? fixture.root : input.candidate === "child" ? join(fixture.root, "project") : input.candidate === "outside" ? fixture.outside : input.candidate === "file" ? fixture.file : join(fixture.root, "missing");
    fixture.expectedPath = input.candidate === "root" || input.candidate === "child" ? realpathSync(candidate) : null;
    fixture.actualPath = fixture.policy.assertDirectory(candidate);
    return fixture.actualPath;
  },
  observe: (fixture) => ({ actualPath: fixture.actualPath, expectedPath: fixture.expectedPath }),
};

type CatalogFixture = {
  root: string;
  repository: string;
  setup: string;
  catalog: WorkspaceSelectionCatalog;
  registered?: Awaited<ReturnType<WorkspaceSelectionCatalog["registerWorkspace"]>>;
  browseGit: boolean;
  resolvedId: string | null;
};
type CatalogStep =
  | { type: "browse" }
  | { type: "register" }
  | { type: "resolve" }
  | { type: "resolve-missing" }
  | { type: "invalid-hook" }
  | { type: "invalid-pattern"; pattern: string };
type CatalogContext = { browseGit: boolean; resolvedId: string | null };

const catalogFixture = (): FixtureHandle<CatalogFixture> => {
  const root = mkdtempSync(join(tmpdir(), "mobile-agent-catalog-"));
  const repository = join(root, "mobile-agent");
  mkdirSync(repository);
  execFileSync("git", ["init", "-q", repository]);
  mkdirSync(join(root, "scratch"));
  const setup = join(root, "setup");
  writeFileSync(setup, "#!/bin/sh\n");
  chmodSync(setup, 0o755);
  return { fixture: { root, repository, setup, catalog: new WorkspaceSelectionCatalog([root]), browseGit: false, resolvedId: null }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};

const catalogCases = [
  {
    name: "browses directories, registers a workspace, and resolves a worktree",
    steps: [{ type: "browse" }, { type: "register" }, { type: "resolve" }],
    assert: [hasObserved<CatalogContext, undefined>("browseGit", true), hasObserved<CatalogContext, undefined>("resolvedId", "registered")],
  },
  {
    name: "rejects an unknown registered workspace id",
    steps: [{ type: "resolve-missing" }],
    assert: [hasError<CatalogContext, undefined>({ code: "invalid_directory", reason: "unknown_workspace" })],
  },
  {
    name: "rejects a non-executable hook during registration",
    steps: [{ type: "invalid-hook" }],
    assert: [hasError<CatalogContext, undefined>({ code: "invalid_hook", reason: "not_executable" })],
  },
  {
    name: "rejects an absolute worktree copy pattern",
    steps: [{ type: "invalid-pattern", pattern: "/absolute/.env" }],
    assert: [hasError<CatalogContext, undefined>({ code: "invalid_copy_pattern" })],
  },
  {
    name: "rejects a parent traversal copy pattern",
    steps: [{ type: "invalid-pattern", pattern: "../outside.env" }],
    assert: [hasError<CatalogContext, undefined>({ code: "invalid_copy_pattern" })],
  },
  {
    name: "rejects an embedded parent traversal copy pattern",
    steps: [{ type: "invalid-pattern", pattern: "config/../../outside.env" }],
    assert: [hasError<CatalogContext, undefined>({ code: "invalid_copy_pattern" })],
  },
  {
    name: "rejects a backslash copy pattern",
    steps: [{ type: "invalid-pattern", pattern: "config\\local.env" }],
    assert: [hasError<CatalogContext, undefined>({ code: "invalid_copy_pattern" })],
  },
] satisfies readonly ScenarioCase<"default", CatalogStep, undefined, CatalogContext>[];

const catalogTable: ScenarioTable<CatalogFixture, "default", CatalogStep, undefined, CatalogContext> = {
  defaultFixture: catalogFixture,
  cases: catalogCases,
  execute: async (fixture, steps) => {
    for (const step of steps) {
      if (step.type === "browse") {
        const workspaces = await fixture.catalog.browseDirectories(fixture.root);
        fixture.browseGit = workspaces.some((workspace) => workspace.name === "mobile-agent" && workspace.isGit);
      }
      if (step.type === "register") {
        fixture.registered = fixture.catalog.registerWorkspace({ directory: fixture.repository, setupScriptPath: fixture.setup, worktreeCopyPatterns: [".env", "config/**/*.local.json"] });
      }
      if (step.type === "resolve") {
        const registered = fixture.registered!;
        const resolved = await fixture.catalog.resolveSelection({ workspaceId: registered.id, mode: "worktree" }, async () => registered);
        fixture.resolvedId = resolved.id === registered.id ? "registered" : resolved.id;
      }
      if (step.type === "resolve-missing") await fixture.catalog.resolveSelection({ workspaceId: "missing", mode: "workspace" }, async () => undefined);
      if (step.type === "invalid-hook") {
        const hook = join(fixture.root, "not-executable");
        writeFileSync(hook, "#!/bin/sh\n");
        fixture.catalog.registerWorkspace({ directory: fixture.repository, setupScriptPath: hook });
      }
      if (step.type === "invalid-pattern") fixture.catalog.registerWorkspace({ directory: fixture.repository, worktreeCopyPatterns: [step.pattern] });
    }
  },
  observe: (fixture) => ({ browseGit: fixture.browseGit, resolvedId: fixture.resolvedId }),
};

describe("workspace selection", () => {
  const register = it as unknown as TestRegistrar;
  runOperationTable(register, rootsTable);
  runOperationTable(register, policyTable);
  runScenarioTable(register, catalogTable);
});
