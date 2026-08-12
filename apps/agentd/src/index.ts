#!/usr/bin/env bun
import { startAgentd } from "./daemon.js";

startAgentd(process.argv.slice(2));
