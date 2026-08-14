import { defineConfig } from "drizzle-kit";
import { resolveAgentdPaths } from "./src/paths.js";

const configuredDatabase = [
  process.env.AGENTD_INSTANCE_DIR,
  process.env.AGENTD_DB_FILE,
  process.env.AGENT_DATABASE_FILE,
].some((value) => Boolean(value?.trim()));

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: configuredDatabase ? resolveAgentdPaths(process.env).databaseFile : "./agentd.sqlite",
  },
});
