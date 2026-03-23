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
  opts: { dlq?: boolean; dlqSubs?: boolean; dlqTopics?: boolean }
): EntityStatus[] {
  if (opts.dlq) {
    // Show only entities that have DLQ > 0
    return entities.filter((e) => e.dlq > 0);
  }

  if (opts.dlqSubs) {
    // Show topics where any subscription has DLQ > 0,
    // including all subscriptions under those topics for context
    const topicsWithDlq = new Set<string>();
    for (const e of entities) {
      if (e.topic && e.dlq > 0) {
        topicsWithDlq.add(e.topic);
      }
    }
    return entities.filter((e) => {
      if (e.type === "queue") return e.dlq > 0;
      return e.topic !== undefined && topicsWithDlq.has(e.topic);
    });
  }

  if (opts.dlqTopics) {
    // Show one row per topic that has any subscription with DLQ > 0 (aggregated)
    const topicAgg = new Map<
      string,
      { active: number; dlq: number; scheduled: number }
    >();
    for (const e of entities) {
      if (!e.topic) continue;
      const agg = topicAgg.get(e.topic) || { active: 0, dlq: 0, scheduled: 0 };
      agg.active += e.active;
      agg.dlq += e.dlq;
      agg.scheduled += e.scheduled;
      topicAgg.set(e.topic, agg);
    }

    const result: EntityStatus[] = [];

    // Queues with DLQ
    for (const e of entities) {
      if (e.type === "queue" && e.dlq > 0) result.push(e);
    }

    // Topics with aggregated DLQ > 0
    for (const [topic, agg] of topicAgg) {
      if (agg.dlq > 0) {
        result.push({
          type: "topic",
          name: topic,
          active: agg.active,
          dlq: agg.dlq,
          scheduled: agg.scheduled,
          topic,
        });
      }
    }

    return result;
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
    "--dlq-subs",
    "Show topics with DLQ subscriptions, including all sibling subscriptions for context"
  )
  .option(
    "--dlq-topics",
    "Show one row per topic that has any DLQ (aggregated counts)"
  )
  .option("--watch [seconds]", "Auto-refresh every N seconds (default: 5)")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: {
      json?: boolean;
      sort?: string;
      dlq?: boolean;
      dlqSubs?: boolean;
      dlqTopics?: boolean;
      watch?: boolean | string;
      namespace?: string;
    }) => {
      const run = async () => {
        let entities = await fetchStatus(opts.namespace);
        entities = filterEntities(entities, {
          dlq: opts.dlq,
          dlqSubs: opts.dlqSubs,
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
            : opts.dlqSubs
              ? " (DLQ subs)"
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
