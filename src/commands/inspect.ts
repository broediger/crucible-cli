import { Command } from "commander";
import chalk from "chalk";
import type { ServiceBusReceivedMessage, ServiceBusClient } from "@azure/service-bus";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

function createReceiver(
  client: ServiceBusClient,
  entity: string,
  dlq?: boolean
) {
  const { queue, topic, subscription } = parseEntity(entity);
  const subQueue = dlq ? "deadLetter" : undefined;
  return topic
    ? client.createReceiver(topic, subscription!, {
        subQueueType: subQueue,
        receiveMode: "peekLock",
      })
    : client.createReceiver(queue!, {
        subQueueType: subQueue,
        receiveMode: "peekLock",
      });
}

function buildJsonOutput(m: ServiceBusReceivedMessage): object {
  return {
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
  };
}

function renderMessage(m: ServiceBusReceivedMessage): void {
  console.log(chalk.bold(`Sequence Number: ${m.sequenceNumber}`));
  console.log();

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

  renderApplicationProperties(m);
  renderBody(m);
}

function renderApplicationProperties(m: ServiceBusReceivedMessage): void {
  if (!m.applicationProperties || Object.keys(m.applicationProperties).length === 0) return;
  console.log();
  console.log(chalk.bold("Application Properties:"));
  for (const [key, val] of Object.entries(m.applicationProperties)) {
    console.log(`  ${chalk.cyan(key + ":")} ${val}`);
  }
}

function renderBody(m: ServiceBusReceivedMessage): void {
  console.log();
  console.log(chalk.bold("Body:"));
  const body =
    typeof m.body === "string" ? m.body : JSON.stringify(m.body, null, 2);
  console.log(body);
}

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
      const receiver = createReceiver(client, entity, opts.dlq);

      try {
        const seqNum = BigInt(opts.seq);
        const messages = await receiver.peekMessages(1, {
          fromSequenceNumber: seqNum as never,
        });

        const m = messages.find(
          (msg) =>
            msg.sequenceNumber !== undefined &&
            BigInt(msg.sequenceNumber.toString()) === seqNum
        );

        if (!m) {
          console.error(
            chalk.red(`No message found with sequence number ${opts.seq}`)
          );
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(buildJsonOutput(m), null, 2));
        } else {
          renderMessage(m);
        }
      } finally {
        await receiver.close();
        await client.close();
      }
    }
  );
