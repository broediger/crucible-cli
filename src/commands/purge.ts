import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export const purgeCommand = new Command("purge")
  .description("Purge (delete) all messages from a queue, subscription, or DLQ")
  .argument("<entity>", "Queue name or topic/subscription")
  .option("--dlq", "Purge dead-letter queue")
  .option("--yes", "Skip confirmation prompt")
  .option("--backup <file>", "Save messages to JSON file before purging")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        dlq?: boolean;
        yes?: boolean;
        backup?: string;
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
        // First, peek to show the user what will be purged
        const preview = await receiver.peekMessages(10);
        const label = opts.dlq ? "DLQ" : "active";

        if (preview.length === 0) {
          console.log(chalk.dim(`No ${label} messages to purge`));
          return;
        }

        console.log(
          chalk.yellow(
            `Found ${preview.length >= 10 ? "10+" : preview.length} ${label} messages in ${entity}`
          )
        );

        // Confirmation prompt
        if (!opts.yes) {
          const ok = await confirm(
            chalk.red(
              `Permanently delete all ${label} messages from ${entity}?`
            )
          );
          if (!ok) {
            console.log(chalk.dim("Aborted"));
            return;
          }
        }

        // Backup before purge if requested
        if (opts.backup) {
          console.log(chalk.dim(`Backing up messages to ${opts.backup}...`));
          const allMessages = await receiver.peekMessages(5000);
          const backupData = allMessages.map((m) => ({
            sequenceNumber: m.sequenceNumber?.toString(),
            messageId: m.messageId,
            correlationId: m.correlationId,
            contentType: m.contentType,
            subject: m.subject,
            enqueuedTime: m.enqueuedTimeUtc?.toISOString(),
            deadLetterReason: m.deadLetterReason,
            deadLetterDescription: m.deadLetterErrorDescription,
            applicationProperties: m.applicationProperties,
            body: m.body,
          }));
          await writeFile(
            opts.backup,
            JSON.stringify(backupData, null, 2),
            "utf-8"
          );
          console.log(
            chalk.green(
              `Backed up ${backupData.length} messages to ${opts.backup}`
            )
          );
        }

        // Purge: receive and complete in batches
        let purged = 0;
        while (true) {
          const batch = await receiver.receiveMessages(100, {
            maxWaitTimeInMs: 3000,
          });
          if (batch.length === 0) break;

          for (const m of batch) {
            await receiver.completeMessage(m);
            purged++;
          }
          process.stdout.write(chalk.dim(`\rPurged ${purged} messages...`));
        }

        console.log(
          `\n${chalk.green(`Purged ${purged} ${label} messages from ${entity}`)}`
        );
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
