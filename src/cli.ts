import { Command } from "commander";
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

const program = new Command();

program
  .name("crucible")
  .description(
    "The kubectl of Azure Service Bus — message operations, DLQ management, and namespace monitoring"
  )
  .version("0.1.0");

program.addCommand(configCommand);
program.addCommand(loginCommand);
program.addCommand(statusCommand);
program.addCommand(monitorCommand);
program.addCommand(peekCommand);
program.addCommand(inspectCommand);
program.addCommand(searchCommand);
program.addCommand(deadletterCommand);
program.addCommand(replayCommand);
program.addCommand(purgeCommand);
program.addCommand(sendCommand);
program.addCommand(watchCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(topologyCommand);

program.parse();
