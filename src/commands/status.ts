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
  topic?: string;
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
        topic: topic.name,
      });
    }
  }

  return entities;
}

function filterEntities(
  entities: EntityStatus[],
  opts: { dlq?: boolean; dlqTopics?: boolean }
): EntityStatus[] {
  if (opts.dlq) {
    // Show only entities that have DLQ > 0
    return entities.filter((e) => e.dlq > 0);
  }

  if (opts.dlqTopics) {
    // Show only topics where at least one subscription has DLQ > 0,
    // and include all subscriptions under those topics
    const topicsWithDlq = new Set<string>();
    for (const e of entities) {
      if (e.topic && e.dlq > 0) {
        topicsWithDlq.add(e.topic);
      }
    }
    return entities.filter((e) => {
      // Keep queues with DLQ
      if (e.type === "queue") return e.dlq > 0;
      // Keep all subscriptions under topics that have any DLQ
      return e.topic !== undefined && topicsWithDlq.has(e.topic);
    });
  }

  return entities;
}

function renderTable(entities: EntityStatus[]): void {
  if (entities.length === 0) {
    console.log(chalk.dim("No matching entities found"));
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
  .option("--dlq", "Show only entities with dead-letter messages")
  .option(
    "--dlq-topics",
    "Show topics where any subscription has dead-letter messages (includes all subs under those topics)"
  )
  .option("--watch [seconds]", "Auto-refresh every N seconds (default: 5)")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: {
      json?: boolean;
      sort?: string;
      dlq?: boolean;
      dlqTopics?: boolean;
      watch?: boolean | string;
      namespace?: string;
    }) => {
      const run = async () => {
        let entities = await fetchStatus(opts.namespace);
        entities = filterEntities(entities, {
          dlq: opts.dlq,
          dlqTopics: opts.dlqTopics,
        });
        sortEntities(entities, opts.sort);

        if (opts.json) {
          console.log(JSON.stringify(entities, null, 2));
        } else {
          renderTable(entities);
        }
      };

      if (opts.watch !== undefined && opts.watch !== false) {
        const interval =
          typeof opts.watch === "string"
            ? Number.parseInt(opts.watch, 10)
            : 5;
        const intervalMs = interval * 1000;

        while (true) {
          process.stdout.write("\x1B[2J\x1B[H");
          const now = new Date().toLocaleTimeString();
          const filterLabel = opts.dlq
            ? " (DLQ only)"
            : opts.dlqTopics
              ? " (DLQ topics)"
              : "";
          console.log(
            chalk.dim(
              `crucible status${filterLabel} — refreshing every ${interval}s — ${now}\n`
            )
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
