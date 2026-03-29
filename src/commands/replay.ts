import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const replayCommand = new Command("replay")
  .description("Replay dead-letter messages back to the source queue")
  .argument("<entity>", "Queue name or topic/subscription")
  .option("--count <number>", "Number of messages to replay")
  .option(
    "--filter <expr>",
    'Filter by DLQ reason (e.g., "reason=MaxDeliveryCountExceeded")'
  )
  .option("--dry-run", "Show what would be replayed without doing it")
  .option("--to <entity>", "Replay to a different destination")
  .option("--backup <file>", "Save messages to JSON file before replaying")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        count?: string;
        filter?: string;
        dryRun?: boolean;
        to?: string;
        backup?: string;
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

      // Determine destination
      const dest = opts.to ? parseEntity(opts.to) : { queue, topic };
      const sender = client.createSender(dest.queue ?? dest.topic!);

      try {
        const maxCount = opts.count
          ? Number.parseInt(opts.count, 10)
          : undefined;
        const messages = await receiver.receiveMessages(maxCount ?? 100, {
          maxWaitTimeInMs: 5000,
        });

        let filterReason: string | undefined;
        if (opts.filter) {
          const match = opts.filter.match(/^reason=(.+)$/);
          if (match) filterReason = match[1];
        }

        // Backup before replay if requested
        if (opts.backup) {
          const backupData = messages.map((m) => ({
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

        let replayed = 0;
        let skipped = 0;

        for (const m of messages) {
          if (maxCount && replayed >= maxCount) break;

          if (filterReason && m.deadLetterReason !== filterReason) {
            skipped++;
            await receiver.abandonMessage(m);
            continue;
          }

          if (opts.dryRun) {
            console.log(
              chalk.dim(
                `[dry-run] Would replay Seq: ${m.sequenceNumber} — ${m.deadLetterReason}`
              )
            );
            await receiver.abandonMessage(m);
            replayed++;
            continue;
          }

          await sender.sendMessages({
            body: m.body,
            contentType: m.contentType,
            correlationId: m.correlationId,
            subject: m.subject,
            applicationProperties: m.applicationProperties,
          });
          await receiver.completeMessage(m);
          replayed++;
        }

        const target = opts.to ?? entity;
        if (opts.dryRun) {
          console.log(
            chalk.yellow(
              `\nDry run: ${replayed} messages would be replayed to ${target}`
            )
          );
        } else {
          console.log(
            chalk.green(`Replayed ${replayed} messages to ${target}`)
          );
        }
        if (skipped > 0) {
          console.log(chalk.dim(`Skipped ${skipped} (filtered out)`));
        }
      } finally {
        await sender.close();
        await receiver.close();
        await client.close();
      }
    }
  );
