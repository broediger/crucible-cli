import { Command } from "commander";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

interface ExportedMessage {
  messageId?: string;
  correlationId?: string;
  contentType?: string;
  subject?: string;
  applicationProperties?: Record<string, unknown>;
  body: unknown;
}

export const importCommand = new Command("import")
  .description("Import messages from a JSON file (bulk send)")
  .argument("<entity>", "Queue name or topic")
  .requiredOption("--file <path>", "JSON file to import (array of messages)")
  .option("--delay <ms>", "Delay between messages in ms", "0")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        file: string;
        delay: string;
        namespace?: string;
      }
    ) => {
      const raw = await readFile(opts.file, "utf-8");
      let messages: ExportedMessage[];

      try {
        const parsed = JSON.parse(raw);
        messages = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        console.error(chalk.red(`Failed to parse ${opts.file} as JSON`));
        process.exit(1);
      }

      const { client } = await createClients(opts.namespace);
      const { queue, topic } = parseEntity(entity);
      const sender = client.createSender(queue ?? topic!);
      const delay = Number.parseInt(opts.delay, 10);

      try {
        let sent = 0;
        for (const m of messages) {
          await sender.sendMessages({
            body: m.body,
            messageId: m.messageId,
            correlationId: m.correlationId,
            contentType: m.contentType,
            subject: m.subject,
            applicationProperties: m.applicationProperties as
              | Record<string, string | number | boolean>
              | undefined,
          });
          sent++;

          if (delay > 0 && sent < messages.length) {
            await new Promise((r) => setTimeout(r, delay));
          }
        }

        console.log(
          chalk.green(`Imported ${sent} messages to ${queue ?? topic}`)
        );
      } finally {
        await sender.close();
        await client.close();
      }
    }
  );
