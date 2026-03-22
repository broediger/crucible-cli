import { Command } from "commander";
import { configCommand } from "./commands/config.js";
import { loginCommand } from "./commands/login.js";
import { statusCommand } from "./commands/status.js";
import { peekCommand } from "./commands/peek.js";
import { inspectCommand } from "./commands/inspect.js";
import { searchCommand } from "./commands/search.js";
import { deadletterCommand } from "./commands/deadletter.js";
import { replayCommand } from "./commands/replay.js";
import { purgeCommand } from "./commands/purge.js";
import { sendCommand } from "./commands/send.js";

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
program.addCommand(peekCommand);
program.addCommand(inspectCommand);
program.addCommand(searchCommand);
program.addCommand(deadletterCommand);
program.addCommand(replayCommand);
program.addCommand(purgeCommand);
program.addCommand(sendCommand);

program.parse();
