import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const inspectCommand = new Command("inspect")
  .description("Inspect a single message by sequence number")
  .argument("<entity>", "Queue name or topic/subscription")
  .requiredOption("--seq <number>", "Sequence number of the message")
  .option("--dlq", "Inspect from dead-letter queue")
  .option("--json", "Output as JSON")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        seq: string;
        dlq?: boolean;
        json?: boolean;
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
        const seqNum = BigInt(opts.seq);
        // The SDK accepts Long.Long but BigInt works at runtime
        const messages = await receiver.peekMessages(1, {
          fromSequenceNumber: seqNum as never,
        });

        const m = messages.find(
          (msg) => msg.sequenceNumber !== undefined &&
            BigInt(msg.sequenceNumber.toString()) === seqNum
        );

        if (!m) {
          console.error(
            chalk.red(`No message found with sequence number ${opts.seq}`)
          );
          process.exit(1);
        }

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                sequenceNumber: m.sequenceNumber?.toString(),
                messageId: m.messageId,
                correlationId: m.correlationId,
                contentType: m.contentType,
                subject: m.subject,
                to: m.to,
                replyTo: m.replyTo,
                enqueuedTime: m.enqueuedTimeUtc?.toISOString(),
                expiresAt: m.expiresAtUtc?.toISOString(),
                timeToLive: m.timeToLive,
                deliveryCount: m.deliveryCount,
                deadLetterReason: m.deadLetterReason,
                deadLetterDescription: m.deadLetterErrorDescription,
                deadLetterSource: m.deadLetterSource,
                sessionId: m.sessionId,
                partitionKey: m.partitionKey,
                applicationProperties: m.applicationProperties,
                body: m.body,
              },
              null,
              2
            )
          );
          return;
        }

        console.log(chalk.bold(`Sequence Number: ${m.sequenceNumber}`));
        console.log();

        // System properties
        const props: Array<[string, unknown]> = [
          ["Message ID", m.messageId],
          ["Correlation ID", m.correlationId],
          ["Content Type", m.contentType],
          ["Subject", m.subject],
          ["To", m.to],
          ["Reply To", m.replyTo],
          ["Session ID", m.sessionId],
          ["Partition Key", m.partitionKey],
          ["Enqueued", m.enqueuedTimeUtc?.toISOString()],
          ["Expires", m.expiresAtUtc?.toISOString()],
          ["TTL", m.timeToLive ? `${m.timeToLive}ms` : undefined],
          ["Delivery Count", m.deliveryCount],
        ];

        if (m.deadLetterReason) {
          props.push(["DLQ Reason", chalk.red(m.deadLetterReason)]);
          props.push(["DLQ Description", m.deadLetterErrorDescription]);
          props.push(["DLQ Source", m.deadLetterSource]);
        }

        for (const [label, value] of props) {
          if (value !== undefined && value !== null && value !== "") {
            console.log(`  ${chalk.cyan(label + ":")} ${value}`);
          }
        }

        // Application properties
        if (
          m.applicationProperties &&
          Object.keys(m.applicationProperties).length > 0
        ) {
          console.log();
          console.log(chalk.bold("Application Properties:"));
          for (const [key, val] of Object.entries(m.applicationProperties)) {
            console.log(`  ${chalk.cyan(key + ":")} ${val}`);
          }
        }

        // Body
        console.log();
        console.log(chalk.bold("Body:"));
        const body =
          typeof m.body === "string"
            ? m.body
            : JSON.stringify(m.body, null, 2);
        console.log(body);
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
