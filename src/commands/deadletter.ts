import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const deadletterCommand = new Command("deadletter")
  .description("List dead-letter messages with reason summary")
  .argument("<entity>", "Queue name or topic/subscription")
  .option("--reasons", "Aggregate by dead-letter reason")
  .option("--count <number>", "Number of messages to peek", "50")
  .option("--json", "Output as JSON")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        reasons?: boolean;
        count: string;
        json?: boolean;
        namespace?: string;
      }
    ) => {
      const { client } = await createClients(opts.namespace);
      const { queue, topic, subscription } = parseEntity(entity);

      const receiver = topic
        ? client.createReceiver(topic, subscription!, {
            subQueueType: "deadLetter",
            receiveMode: "peekLock",
          })
        : client.createReceiver(queue!, {
            subQueueType: "deadLetter",
            receiveMode: "peekLock",
          });

      try {
        const messages = await receiver.peekMessages(
          Number.parseInt(opts.count, 10)
        );

        if (messages.length === 0) {
          console.log(chalk.green("No dead-letter messages"));
          return;
        }

        if (opts.reasons) {
          const reasons = new Map<string, number>();
          for (const m of messages) {
            const reason = m.deadLetterReason ?? "Unknown";
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
          }

          if (opts.json) {
            console.log(JSON.stringify(Object.fromEntries(reasons), null, 2));
            return;
          }

          console.log(
            chalk.bold(`Dead-letter reasons (${messages.length} messages):\n`)
          );
          for (const [reason, count] of [...reasons.entries()].sort(
            (a, b) => b[1] - a[1]
          )) {
            console.log(
              `  ${chalk.yellow(count.toString().padStart(4))}  ${reason}`
            );
          }
          return;
        }

        if (opts.json) {
          const output = messages.map((m) => ({
            sequenceNumber: m.sequenceNumber?.toString(),
            enqueuedTime: m.enqueuedTimeUtc?.toISOString(),
            deadLetterReason: m.deadLetterReason,
            deadLetterDescription: m.deadLetterErrorDescription,
            body: m.body,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        for (const m of messages) {
          console.log(
            `${chalk.dim(`Seq: ${m.sequenceNumber}`)}  ${chalk.red(m.deadLetterReason ?? "Unknown")}  ${chalk.dim(m.enqueuedTimeUtc?.toISOString() ?? "")}`
          );
        }
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
