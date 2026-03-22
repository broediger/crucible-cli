import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { createClients } from "../lib/client.js";

interface EntityStatus {
  type: string;
  name: string;
  active: number;
  dlq: number;
  scheduled: number;
}

async function fetchStatus(namespace?: string): Promise<EntityStatus[]> {
  const { admin } = await createClients(namespace);
  const entities: EntityStatus[] = [];

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

  return entities;
}

function renderTable(entities: EntityStatus[]): void {
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
}

function sortEntities(entities: EntityStatus[], sort?: string): void {
  if (!sort) return;
  const key = sort as keyof EntityStatus;
  entities.sort((a, b) => {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    return av > bv ? -1 : av < bv ? 1 : 0;
  });
}

export const statusCommand = new Command("status")
  .description("Show queue/topic health overview")
  .option("--json", "Output as JSON")
  .option("--sort <field>", "Sort by field: name, active, dlq, scheduled")
  .option("--watch [seconds]", "Auto-refresh every N seconds (default: 5)")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: {
      json?: boolean;
      sort?: string;
      watch?: boolean | string;
      namespace?: string;
    }) => {
      const run = async () => {
        const entities = await fetchStatus(opts.namespace);
        sortEntities(entities, opts.sort);

        if (opts.json) {
          console.log(JSON.stringify(entities, null, 2));
        } else {
          renderTable(entities);
        }
      };

      if (opts.watch !== undefined && opts.watch !== false) {
        const interval =
          typeof opts.watch === "string" ? parseInt(opts.watch, 10) : 5;
        const intervalMs = interval * 1000;

        // Run once, then loop
        while (true) {
          // Clear screen
          process.stdout.write("\x1B[2J\x1B[H");
          const now = new Date().toLocaleTimeString();
          console.log(
            chalk.dim(`crucible status — refreshing every ${interval}s — ${now}\n`)
          );
          try {
            await run();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`Error: ${msg}`));
          }
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      } else {
        await run();
      }
    }
  );
