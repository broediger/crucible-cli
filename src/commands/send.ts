import { Command } from "commander";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const sendCommand = new Command("send")
  .description("Send a message to a queue or topic")
  .argument("<entity>", "Queue name or topic")
  .option("--body <json>", "Message body (JSON string)")
  .option("--file <path>", "Read message body from file")
  .option("--property <kv...>", "Application properties (key=value)")
  .option("--count <number>", "Send N copies", "1")
  .option("--delay <ms>", "Delay between messages in ms", "0")
  .option("--schedule <iso>", "Schedule message for future delivery (ISO 8601)")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        body?: string;
        file?: string;
        property?: string[];
        count: string;
        delay: string;
        schedule?: string;
        namespace?: string;
      }
    ) => {
      if (!opts.body && !opts.file) {
        console.error(chalk.red("Provide --body or --file"));
        process.exit(1);
      }

      let body: unknown;
      if (opts.file) {
        const raw = await readFile(opts.file, "utf-8");
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      } else {
        try {
          body = JSON.parse(opts.body!);
        } catch {
          body = opts.body;
        }
      }

      const properties: Record<string, string> = {};
      if (opts.property) {
        for (const kv of opts.property) {
          const [key, ...rest] = kv.split("=");
          properties[key] = rest.join("=");
        }
      }

      const { client } = await createClients(opts.namespace);
      const { queue, topic } = parseEntity(entity);
      const sender = client.createSender(queue ?? topic!);

      try {
        const count = Number.parseInt(opts.count, 10);
        const delay = Number.parseInt(opts.delay, 10);

        for (let i = 0; i < count; i++) {
          if (opts.schedule) {
            await sender.scheduleMessages(
              {
                body,
                applicationProperties:
                  Object.keys(properties).length > 0 ? properties : undefined,
              },
              new Date(opts.schedule)
            );
          } else {
            await sender.sendMessages({
              body,
              applicationProperties:
                Object.keys(properties).length > 0 ? properties : undefined,
            });
          }

          if (delay > 0 && i < count - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        const target = queue ?? topic!;
        if (opts.schedule) {
          console.log(
            chalk.green(
              `Scheduled ${count} message(s) to ${target} for ${opts.schedule}`
            )
          );
        } else {
          console.log(chalk.green(`Sent ${count} message(s) to ${target}`));
        }
      } finally {
        await sender.close();
        await client.close();
      }
    }
  );
