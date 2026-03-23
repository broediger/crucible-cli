import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const peekCommand = new Command("peek")
  .description("Peek messages from a queue or subscription")
  .argument("<entity>", "Queue name or topic/subscription")
  .option("--dlq", "Peek from dead-letter queue")
  .option("--count <number>", "Number of messages to peek", "10")
  .option("--format <type>", "Output format: json, table", "table")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        dlq?: boolean;
        count: string;
        format: string;
        namespace?: string;
      }
    ) => {
      const { client } = await createClients(opts.namespace);
      const { queue, topic, subscription } = parseEntity(entity);

      const receiver = topic
        ? client.createReceiver(topic, subscription!, {
            subQueueType: opts.dlq ? "deadLetter" : undefined,
            receiveMode: "peekLock",
          })
        : client.createReceiver(queue!, {
            subQueueType: opts.dlq ? "deadLetter" : undefined,
            receiveMode: "peekLock",
          });

      try {
        const messages = await receiver.peekMessages(Number.parseInt(opts.count, 10));

        if (messages.length === 0) {
          console.log(chalk.dim("No messages found"));
          return;
        }

        if (opts.format === "json") {
          const output = messages.map((m) => ({
            sequenceNumber: m.sequenceNumber?.toString(),
            enqueuedTime: m.enqueuedTimeUtc?.toISOString(),
            contentType: m.contentType,
            subject: m.subject,
            properties: m.applicationProperties,
            body: m.body,
            deadLetterReason: m.deadLetterReason,
            deadLetterDescription: m.deadLetterErrorDescription,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        for (const m of messages) {
          console.log(chalk.bold(`--- Seq: ${m.sequenceNumber} ---`));
          if (m.enqueuedTimeUtc) {
            console.log(chalk.dim(`Enqueued: ${m.enqueuedTimeUtc.toISOString()}`));
          }
          if (m.deadLetterReason) {
            console.log(chalk.red(`DLQ Reason: ${m.deadLetterReason}`));
          }
          if (m.applicationProperties && Object.keys(m.applicationProperties).length > 0) {
            console.log(chalk.cyan("Properties:"), JSON.stringify(m.applicationProperties));
          }
          const body =
            typeof m.body === "string"
              ? m.body
              : JSON.stringify(m.body, null, 2);
          console.log(body);
          console.log();
        }
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
