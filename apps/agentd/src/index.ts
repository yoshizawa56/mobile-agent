#!/usr/bin/env node
import { createAgentdServer } from "./server.js";

const port = Number(process.env.AGENTD_PORT ?? 4317);
const host = process.env.AGENTD_HOST ?? "127.0.0.1";

const app = createAgentdServer({ host, port });
app.start();

const shutdown = () => {
  app.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
