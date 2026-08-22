import type { AgentDrizzleDatabase } from "./database-types.js";
import { ambientDatabase } from "./transaction-context.js";

export abstract class DrizzleRepositoryBase {
  protected constructor(private readonly rootDatabase: AgentDrizzleDatabase) {}

  protected db(): AgentDrizzleDatabase {
    return ambientDatabase(this.rootDatabase);
  }
}
