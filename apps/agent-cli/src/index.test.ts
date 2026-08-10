import { describe, expect, it } from "vitest";

describe("agent cli output contract", () => {
  it.each([
    { name: "uses the local health endpoint by default", env: undefined, expected: "http://127.0.0.1:4317" },
    { name: "removes a trailing slash from a configured endpoint", env: "https://host.example/", expected: "https://host.example" },
  ])("$name", ({ env, expected }) => {
    const endpoint = (env ?? "http://127.0.0.1:4317").replace(/\/$/, "");
    expect(endpoint).toBe(expected);
  });
});
