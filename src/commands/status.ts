import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { createClients } from "../lib/client.js";

export const statusCommand = new Command("status")
  .description("Show queue/topic health overview")
  .option("--json", "Output as JSON")
  .option("--sort <field>", "Sort by field: name, active, dlq, scheduled")
  .option("--namespace <fqdn>", "Override namespace")
  .action(async (opts: { json?: boolean; sort?: string; namespace?: string }) => {
    const { admin } = await createClients(opts.namespace);

    const entities: Array<{
      type: string;
      name: string;
      active: number;
      dlq: number;
      scheduled: number;
    }> = [];

    // Queues
    for await (const queue of admin.listQueues()) {
      const runtime = await admin.getQueueRuntimeProperties(queue.name);
      entities.push({
        type: "queue",
        name: queue.name,
        active: runtime.activeMessageCount,
        dlq: runtime.deadLetterMessageCount,
        scheduled: runtime.scheduledMessageCount,
      });
    }

    // Topics + Subscriptions
    for await (const topic of admin.listTopics()) {
      for await (const sub of admin.listSubscriptions(topic.name)) {
        const runtime = await admin.getSubscriptionRuntimeProperties(
          topic.name,
          sub.subscriptionName
        );
        entities.push({
          type: "topic/sub",
          name: `${topic.name}/${sub.subscriptionName}`,
          active: runtime.activeMessageCount,
          dlq: runtime.deadLetterMessageCount,
          scheduled: 0,
        });
      }
    }

    // Sort
    if (opts.sort) {
      const key = opts.sort as keyof (typeof entities)[0];
      entities.sort((a, b) => {
        const av = a[key] ?? 0;
        const bv = b[key] ?? 0;
        return av > bv ? -1 : av < bv ? 1 : 0;
      });
    }

    // Output
    if (opts.json) {
      console.log(JSON.stringify(entities, null, 2));
      return;
    }

    const table = new Table({
      head: ["Type", "Name", "Active", "DLQ", "Scheduled"].map((h) =>
        chalk.bold(h)
      ),
    });

    for (const e of entities) {
      const dlqColor =
        e.dlq > 10 ? chalk.red : e.dlq > 0 ? chalk.yellow : chalk.green;

      table.push([
        chalk.dim(e.type),
        e.name,
        e.active.toString(),
        dlqColor(e.dlq.toString()),
        e.scheduled.toString(),
      ]);
    }

    console.log(table.toString());
  });
