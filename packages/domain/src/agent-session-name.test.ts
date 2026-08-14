import { describe, expect, it } from "vitest";
import { InvalidAgentSessionNameError, normalizeAgentSessionName } from "./index.js";

type Outcome<Result> =
  | { ok: true; value: Result }
  | { ok: false; error: unknown };

type NameAssertion = "returns-value" | "returns-invalid-name-error";

type NameCase = {
  name: string;
  input: string;
  expected: { value?: string; errorCode?: string };
  assert: readonly NameAssertion[];
};

type Observed = {
  value: string | undefined;
  errorCode: string | undefined;
};

const cases = [
  {
    name: "lowercases a name and turns spaces into hyphens",
    input: "API review",
    expected: { value: "api-review" },
    assert: ["returns-value"],
  },
  {
    name: "removes git ref and path punctuation",
    input: "feature/foo:bar? [draft]",
    expected: { value: "feature-foo-bar-draft" },
    assert: ["returns-value"],
  },
  {
    name: "avoids repeated dots and lock suffixes",
    input: "...My..branch.lock",
    expected: { value: "my-branch-lock" },
    assert: ["returns-value"],
  },
  {
    name: "keeps Japanese letters as best effort while normalizing spaces",
    input: "日本語 レビュー",
    expected: { value: "日本語-レビュー" },
    assert: ["returns-value"],
  },
  {
    name: "limits the normalized name to 64 characters",
    input: "A".repeat(80),
    expected: { value: "a".repeat(64) },
    assert: ["returns-value"],
  },
  {
    name: "limits multibyte names to a safe UTF-8 component size",
    input: "𐌀".repeat(64),
    expected: { value: "𐌀".repeat(60) },
    assert: ["returns-value"],
  },
  {
    name: "rejects a name with no letters or numbers",
    input: "--- ...",
    expected: { errorCode: "invalid_agent_name" },
    assert: ["returns-invalid-name-error"],
  },
] satisfies readonly NameCase[];

function execute(input: string): Outcome<string> {
  try {
    return { ok: true, value: normalizeAgentSessionName(input) };
  } catch (error) {
    return { ok: false, error };
  }
}

function observe(outcome: Outcome<string>): Observed {
  if (outcome.ok) return { value: outcome.value, errorCode: undefined };
  const errorCode = outcome.error && typeof outcome.error === "object" && "code" in outcome.error && typeof outcome.error.code === "string"
    ? outcome.error.code
    : undefined;
  return { value: undefined, errorCode };
}

function assertAll(row: NameCase, outcome: Outcome<string>, observed: Observed): void {
  const failures: Error[] = [];
  for (const assertion of row.assert) {
    try {
      if (assertion === "returns-value") {
        expect(outcome.ok).toBe(true);
        expect(observed.value).toBe(row.expected.value);
      } else {
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? undefined : outcome.error).toBeInstanceOf(InvalidAgentSessionNameError);
        expect(observed.errorCode).toBe(row.expected.errorCode);
      }
    } catch (error) {
      failures.push(new Error(`${assertion}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, `${row.name} failed`);
}

describe("agent session name normalization", () => {
  it.each(cases)("$name", (row) => {
    const outcome = execute(row.input);
    const observed = observe(outcome);
    assertAll(row, outcome, observed);
  });
});
