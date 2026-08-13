#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { arch, homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = "yoshizawa56/mobile-agent";
const installRoot = resolve(process.env.AGENT_INSTALL_DIR ?? join(homedir(), ".local", "libexec", "mobile-agent"));
const installBinary = join(installRoot, "agent");
const commandDirectory = resolve(process.env.AGENT_BIN_DIR ?? join(homedir(), ".local", "bin"));
const commandPath = join(commandDirectory, "agent");
const args = new Set(process.argv.slice(2));
const fromBuild = args.has("--from-build");
const tag = valueAfter("--tag") ?? process.env.AGENT_RELEASE_TAG;
const asset = releaseAsset();
const temporaryRoot = mkdtempSync(join(tmpdir(), "mobile-agent-install-"));
const temporaryBinary = join(temporaryRoot, asset);

try {
  mkdirSync(installRoot, { recursive: true, mode: 0o755 });
  if (fromBuild) {
    const source = resolve(optionalValueAfter("--from-build") ?? process.env.AGENT_BUILD_BINARY ?? "dist/agent");
    if (!existsSync(source)) throw new Error(`local production binary not found: ${source}`);
    writeFileSync(temporaryBinary, readFileSync(source));
    process.stdout.write(`Installing local production build: ${source}\n`);
  } else {
    const baseUrl = tag
      ? `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`
      : `https://github.com/${repository}/releases/latest/download`;
    const binaryUrl = `${baseUrl}/${asset}`;
    const checksumUrl = `${baseUrl}/SHA256SUMS.txt`;
    const [binaryResponse, checksumResponse] = await Promise.all([fetch(binaryUrl), fetch(checksumUrl)]);
    if (!binaryResponse.ok) throw new Error(`could not download ${binaryUrl}: HTTP ${binaryResponse.status}`);
    if (!checksumResponse.ok) throw new Error(`could not download ${checksumUrl}: HTTP ${checksumResponse.status}`);
    const binaryData = Buffer.from(await binaryResponse.arrayBuffer());
    const checksumText = await checksumResponse.text();
    const expected = checksumFor(checksumText, asset);
    const actual = createHash("sha256").update(binaryData).digest("hex");
    if (actual !== expected) throw new Error(`checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
    writeFileSync(temporaryBinary, binaryData);
    process.stdout.write(`Installing ${tag ?? "latest stable"} release: ${asset}\n`);
  }

  chmodSync(temporaryBinary, 0o755);
  renameSync(temporaryBinary, installBinary);
  installCommandLink();
  process.stdout.write(`Installed production binary: ${installBinary}\n`);
  process.stdout.write(`Installed production command: ${commandPath}\n`);
  process.stdout.write("Use 'agent' for the production binary. Run 'bun dev' directly in a linked worktree for source-based development.\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function releaseAsset() {
  const target = `${platform()}-${arch()}`;
  const supported = new Set(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
  if (!supported.has(target)) throw new Error(`unsupported platform: ${target}`);
  return `agent-${target}`;
}

function checksumFor(contents, filename) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match?.[2] === filename) return match[1].toLowerCase();
  }
  throw new Error(`checksum for ${filename} was not found in SHA256SUMS.txt`);
}

function installCommandLink() {
  mkdirSync(commandDirectory, { recursive: true, mode: 0o755 });
  const temporaryLink = join(commandDirectory, `.agent-link-${process.pid}`);
  rmSync(temporaryLink, { force: true });
  symlinkSync(installBinary, temporaryLink);
  try {
    renameSync(temporaryLink, commandPath);
  } finally {
    rmSync(temporaryLink, { force: true });
  }
}

function valueAfter(option) {
  const index = process.argv.indexOf(option);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function optionalValueAfter(option) {
  const index = process.argv.indexOf(option);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}
