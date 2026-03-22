import { Command } from "commander";
import { configCommand } from "./commands/config.js";
import { statusCommand } from "./commands/status.js";
import { peekCommand } from "./commands/peek.js";
import { deadletterCommand } from "./commands/deadletter.js";
import { replayCommand } from "./commands/replay.js";
import { sendCommand } from "./commands/send.js";

const program = new Command();

program
  .name("crucible")
  .description(
    "The kubectl of Azure Service Bus — message operations, DLQ management, and namespace monitoring"
  )
  .version("0.1.0");

program.addCommand(configCommand);
program.addCommand(statusCommand);
program.addCommand(peekCommand);
program.addCommand(deadletterCommand);
program.addCommand(replayCommand);
program.addCommand(sendCommand);

program.parse();
