import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, createRotatingFileSink, createStreamSink, errorFields, errorMessage, formatHumanRecord, parseLogLevel, type LogRecord } from "./index.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("structured logger", () => {
  it("adds process metadata and immutable child context", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      service: "agent-cli",
      mode: "attached",
      level: "debug",
      sink: { write: (record) => records.push(record) },
      processInstanceId: "process-1",
      pid: 123,
      clock: () => new Date("2026-08-14T00:00:00.000Z"),
    });
    const child = logger.child({ command: "run", sessionId: "session-1" });

    child.debug("session.started", { backend: "claude", token: "do-not-log" });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: "2026-08-14T00:00:00.000Z",
      service: "agent-cli",
      pid: 123,
      processInstanceId: "process-1",
      mode: "attached",
      event: "session.started",
      context: { command: "run", sessionId: "session-1" },
      fields: { backend: "claude", token: "[REDACTED]" },
    });
  });

  it("renders human output without a stack by default and includes it in verbose mode", () => {
    const record: LogRecord = {
      timestamp: "2026-08-14T00:00:00.000Z",
      level: "error",
      service: "agent-cli",
      pid: 123,
      processInstanceId: "process-1",
      mode: "attached",
      event: "process.unhandled_error",
      context: {},
      fields: {
        message: "unexpected error: failed to connect",
        error: { name: "Error", message: "failed to connect", stack: "Error: failed to connect\n    at main" },
      },
    };

    expect(formatHumanRecord(record)).toContain("unexpected error: failed to connect");
    expect(formatHumanRecord(record)).not.toContain("at main");
    expect(formatHumanRecord(record, true)).toContain("at main");
  });

  it("writes background logs as JSON and rotates bounded files", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-agent-logging-test-"));
    temporaryRoots.push(root);
    const logDirectory = join(root, "logs");
    const path = join(logDirectory, "agentd.log");
    const logger = createLogger({
      service: "agentd",
      mode: "background",
      level: "info",
      sink: createRotatingFileSink(path, { maxBytes: 240, maxFiles: 2 }),
      processInstanceId: "process-1",
      pid: 123,
    });

    for (let index = 0; index < 8; index += 1) logger.info("daemon.health_check", { attempt: index, ok: true });

    const files = readdirSync(logDirectory).filter((file) => file.startsWith("agentd.log"));
    expect(files).toContain("agentd.log");
    expect(files.length).toBeLessThanOrEqual(3);
    expect(JSON.parse(readFileSync(path, "utf8").trim())).toMatchObject({ service: "agentd", event: "daemon.health_check" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(logDirectory).mode & 0o777).toBe(0o700);
  });

  it("isolates synchronous and asynchronous stream failures", async () => {
    let writes = 0;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        writes += 1;
        callback(new Error("stream closed"));
      },
    });
    const logger = createLogger({
      service: "agent-cli",
      mode: "attached",
      level: "debug",
      sink: createStreamSink(output, "human"),
    });

    expect(() => logger.error("process.unhandled_error")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(() => logger.error("process.unhandled_error")).not.toThrow();
    expect(writes).toBe(1);

    const throwingLogger = createLogger({
      service: "agent-cli",
      mode: "attached",
      level: "error",
      sink: {
        write() {
          throw new Error("sink failed");
        },
        close() {
          throw new Error("close failed");
        },
      },
    });
    expect(() => throwingLogger.error("process.unhandled_error")).not.toThrow();
    expect(() => throwingLogger.close()).not.toThrow();
  });

  it("filters records by level and parses configured levels", () => {
    let output = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger({ service: "agent-cli", mode: "attached", level: "warn", sink: createStreamSink(stream, "human") });

    logger.info("command.started");
    logger.warn("command.warning");

    expect(output).not.toContain("command.started");
    expect(output).toContain("command.warning");
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("invalid", "info")).toBe("info");
  });

  it("keeps hostile errors and subprocess diagnostics safe", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("ownKeys should not escape diagnostics");
      },
    });
    expect(() => errorFields(hostile)).not.toThrow();

    const subprocessError = new Error("Command failed: backend --prompt sensitive prompt\nsecret output");
    Object.defineProperty(subprocessError, "cause", {
      configurable: true,
      get() {
        throw new Error("cause accessor failed");
      },
    });
    const fields = errorFields(subprocessError);
    expect(JSON.stringify(fields)).not.toContain("sensitive prompt");
    expect(JSON.stringify(fields)).not.toContain("secret output");

    const throwingMessage = new Error("fallback");
    Object.defineProperty(throwingMessage, "message", {
      configurable: true,
      get() {
        throw new Error("message accessor failed");
      },
    });
    expect(errorMessage(throwingMessage)).toBe("unknown error");
    expect(() => errorFields(throwingMessage)).not.toThrow();
  });
});
