import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const exportCommand = new Command("export")
  .description("Export messages from a queue or subscription")
  .argument("<entity>", "Queue name or topic/subscription")
  .option("--dlq", "Export from dead-letter queue")
  .option("--count <number>", "Max messages to export", "100")
  .option("--format <type>", "Output format: json, csv", "json")
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
        const messages = await receiver.peekMessages(
          parseInt(opts.count, 10)
        );

        if (messages.length === 0) {
          console.error(chalk.dim("No messages found"));
          return;
        }

        const rows = messages.map((m) => ({
          sequenceNumber: m.sequenceNumber?.toString() ?? "",
          messageId: m.messageId ?? "",
          correlationId: m.correlationId ?? "",
          contentType: m.contentType ?? "",
          subject: m.subject ?? "",
          enqueuedTime: m.enqueuedTimeUtc?.toISOString() ?? "",
          deadLetterReason: m.deadLetterReason ?? "",
          deadLetterDescription: m.deadLetterErrorDescription ?? "",
          applicationProperties: m.applicationProperties ?? {},
          body: m.body,
        }));

        if (opts.format === "csv") {
          // CSV header
          const csvCols = [
            "sequenceNumber",
            "messageId",
            "correlationId",
            "contentType",
            "subject",
            "enqueuedTime",
            "deadLetterReason",
            "body",
          ];
          console.log(csvCols.join(","));

          for (const r of rows) {
            const bodyStr =
              typeof r.body === "string"
                ? r.body
                : JSON.stringify(r.body);
            const fields = [
              r.sequenceNumber,
              r.messageId,
              r.correlationId,
              r.contentType,
              r.subject,
              r.enqueuedTime,
              r.deadLetterReason,
              bodyStr,
            ];
            // Escape CSV fields
            console.log(
              fields
                .map((f) => {
                  const s = String(f ?? "");
                  return s.includes(",") || s.includes('"') || s.includes("\n")
                    ? `"${s.replace(/"/g, '""')}"`
                    : s;
                })
                .join(",")
            );
          }
        } else {
          // JSON — output to stdout for piping
          console.log(JSON.stringify(rows, null, 2));
        }

        console.error(
          chalk.dim(`Exported ${rows.length} messages`)
        );
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
