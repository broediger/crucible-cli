import { createRequire } from "node:module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
import { configCommand } from "./commands/config.js";
import { loginCommand } from "./commands/login.js";
import { statusCommand } from "./commands/status.js";
import { monitorCommand } from "./commands/monitor.js";
import { peekCommand } from "./commands/peek.js";
import { inspectCommand } from "./commands/inspect.js";
import { searchCommand } from "./commands/search.js";
import { deadletterCommand } from "./commands/deadletter.js";
import { replayCommand } from "./commands/replay.js";
import { purgeCommand } from "./commands/purge.js";
import { sendCommand } from "./commands/send.js";
import { watchCommand } from "./commands/watch.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { topologyCommand } from "./commands/topology.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { diffCommand } from "./commands/diff.js";
import { costsCommand } from "./commands/costs.js";

const program = new Command();

program
  .name("crucible")
  .description(
    "The kubectl of Azure Service Bus — message operations, DLQ management, and namespace monitoring"
  )
  .version(version);

// --- Phase 1: Foundation ---
program.addCommand(configCommand);
program.addCommand(loginCommand);

// --- Phase 2: Core Commands ---
program.addCommand(statusCommand);
program.addCommand(peekCommand);
program.addCommand(inspectCommand);
program.addCommand(searchCommand);
program.addCommand(deadletterCommand);
program.addCommand(replayCommand);
program.addCommand(purgeCommand);
program.addCommand(sendCommand);

// --- Phase 3: Monitoring & Advanced ---
program.addCommand(monitorCommand);
program.addCommand(watchCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(topologyCommand);

// --- Phase 4: Power Features ---
program.addCommand(snapshotCommand);
program.addCommand(diffCommand);
program.addCommand(costsCommand);

// --- Global error handler ---
// Exit codes: 0 = success, 1 = error, 2 = warning/threshold (set by commands like diff)
process.on("unhandledRejection", (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});

program.parse();
