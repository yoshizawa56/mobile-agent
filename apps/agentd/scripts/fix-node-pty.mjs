import { chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nodePtyEntry = require.resolve("node-pty");
const nodePtyRoot = dirname(dirname(nodePtyEntry));
const helperPath = join(nodePtyRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");

try {
  await chmod(helperPath, 0o755);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
