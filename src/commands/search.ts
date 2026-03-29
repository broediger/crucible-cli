import type { ServiceBusReceivedMessage } from "@azure/service-bus";
import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const searchCommand = new Command("search")
  .description("Search messages by body content or application properties")
  .argument("<entity>", "Queue name or topic/subscription")
  .option("--body <text>", "Search for text in message body")
  .option("--property <kv>", "Match application property (key=value)")
  .option("--dlq", "Search dead-letter queue")
  .option("--count <number>", "Max messages to scan", "100")
  .option("--format <type>", "Output format: json, table", "table")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        body?: string;
        property?: string;
        dlq?: boolean;
        count: string;
        format: string;
        namespace?: string;
      }
    ) => {
      if (!opts.body && !opts.property) {
        console.error(chalk.red("Provide --body or --property to search"));
        process.exit(1);
      }

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

      // Parse property filter
      let propKey: string | undefined;
      let propValue: string | undefined;
      if (opts.property) {
        const eqIdx = opts.property.indexOf("=");
        if (eqIdx < 0) {
          console.error(chalk.red("--property must be key=value format"));
          process.exit(1);
        }
        propKey = opts.property.slice(0, eqIdx);
        propValue = opts.property.slice(eqIdx + 1);
      }

      try {
        const scanCount = Number.parseInt(opts.count, 10);
        const batchSize = 100;
        const matches: ServiceBusReceivedMessage[] = [];
        let scanned = 0;
        let peekOptions: { fromSequenceNumber?: never } = {};

        // Peek in batches to reliably scan beyond single-call limits
        while (scanned < scanCount) {
          const remaining = scanCount - scanned;
          const batch = await receiver.peekMessages(
            Math.min(batchSize, remaining),
            peekOptions
          );

          if (batch.length === 0) break;

          for (const m of batch) {
            let isMatch = true;

            // Body filter (case-insensitive substring match)
            if (opts.body) {
              const bodyStr =
                typeof m.body === "string" ? m.body : JSON.stringify(m.body);
              if (!bodyStr.toLowerCase().includes(opts.body.toLowerCase())) {
                isMatch = false;
              }
            }

            // Property filter
            if (isMatch && propKey && propValue) {
              const props = m.applicationProperties;
              if (!props) {
                isMatch = false;
              } else {
                const val = String(props[propKey] ?? "");
                if (val !== propValue) isMatch = false;
              }
            }

            if (isMatch) matches.push(m);
          }

          scanned += batch.length;
          // Next batch starts after the last message's sequence number
          const lastSeq = batch[batch.length - 1].sequenceNumber;
          if (lastSeq !== undefined) {
            peekOptions = {
              fromSequenceNumber: (BigInt(lastSeq.toString()) + 1n) as never,
            };
          }
        }

        if (matches.length === 0) {
          console.log(
            chalk.dim(`No matches found (scanned ${scanned} messages)`)
          );
          return;
        }

        console.log(
          chalk.dim(
            `${matches.length} match(es) found (scanned ${scanned} messages)\n`
          )
        );

        if (opts.format === "json") {
          const output = matches.map((m) => ({
            sequenceNumber: m.sequenceNumber?.toString(),
            enqueuedTime: m.enqueuedTimeUtc?.toISOString(),
            contentType: m.contentType,
            subject: m.subject,
            properties: m.applicationProperties,
            body: m.body,
            deadLetterReason: m.deadLetterReason,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        for (const m of matches) {
          console.log(chalk.bold(`--- Seq: ${m.sequenceNumber} ---`));
          if (m.enqueuedTimeUtc) {
            console.log(
              chalk.dim(`Enqueued: ${m.enqueuedTimeUtc.toISOString()}`)
            );
          }
          if (m.deadLetterReason) {
            console.log(chalk.red(`DLQ Reason: ${m.deadLetterReason}`));
          }
          if (
            m.applicationProperties &&
            Object.keys(m.applicationProperties).length > 0
          ) {
            console.log(
              chalk.cyan("Properties:"),
              JSON.stringify(m.applicationProperties)
            );
          }

          // Highlight the matching text in the body
          let body =
            typeof m.body === "string"
              ? m.body
              : JSON.stringify(m.body, null, 2);

          if (opts.body) {
            const regex = new RegExp(
              `(${opts.body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
              "gi"
            );
            body = body.replace(regex, chalk.bgYellow.black("$1"));
          }

          console.log(body);
          console.log();
        }
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
