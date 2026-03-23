import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { createClients } from "../lib/client.js";

export interface NamespaceSnapshot {
  capturedAt: string;
  namespace: string;
  queues: QueueSnapshot[];
  topics: TopicSnapshot[];
}

export interface QueueSnapshot {
  name: string;
  maxSizeInMegabytes: number;
  maxDeliveryCount: number;
  lockDuration: string;
  defaultMessageTimeToLive: string;
  deadLetteringOnMessageExpiration: boolean;
  requiresDuplicateDetection: boolean;
  enablePartitioning: boolean;
  requiresSession: boolean;
  status: string;
}

export interface TopicSnapshot {
  name: string;
  maxSizeInMegabytes: number;
  defaultMessageTimeToLive: string;
  requiresDuplicateDetection: boolean;
  enablePartitioning: boolean;
  status: string;
  subscriptions: SubscriptionSnapshot[];
}

export interface SubscriptionSnapshot {
  name: string;
  maxDeliveryCount: number;
  lockDuration: string;
  defaultMessageTimeToLive: string;
  deadLetteringOnMessageExpiration: boolean;
  requiresSession: boolean;
  rules: RuleSnapshot[];
}

export interface RuleSnapshot {
  name: string;
  filter: unknown;
  action: unknown;
}

export async function captureSnapshot(
  namespace?: string
): Promise<NamespaceSnapshot> {
  const { admin } = await createClients(namespace);
  const queues: QueueSnapshot[] = [];
  const topics: TopicSnapshot[] = [];

  for await (const q of admin.listQueues()) {
    queues.push({
      name: q.name,
      maxSizeInMegabytes: q.maxSizeInMegabytes,
      maxDeliveryCount: q.maxDeliveryCount,
      lockDuration: q.lockDuration,
      defaultMessageTimeToLive: q.defaultMessageTimeToLive,
      deadLetteringOnMessageExpiration: q.deadLetteringOnMessageExpiration,
      requiresDuplicateDetection: q.requiresDuplicateDetection,
      enablePartitioning: q.enablePartitioning,
      requiresSession: q.requiresSession,
      status: q.status,
    });
  }

  for await (const t of admin.listTopics()) {
    const subs: SubscriptionSnapshot[] = [];

    for await (const s of admin.listSubscriptions(t.name)) {
      const rules: RuleSnapshot[] = [];
      for await (const r of admin.listRules(t.name, s.subscriptionName)) {
        rules.push({
          name: r.name,
          filter: r.filter,
          action: r.action,
        });
      }
      subs.push({
        name: s.subscriptionName,
        maxDeliveryCount: s.maxDeliveryCount,
        lockDuration: s.lockDuration,
        defaultMessageTimeToLive: s.defaultMessageTimeToLive,
        deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration,
        requiresSession: s.requiresSession,
        rules,
      });
    }

    topics.push({
      name: t.name,
      maxSizeInMegabytes: t.maxSizeInMegabytes,
      defaultMessageTimeToLive: t.defaultMessageTimeToLive,
      requiresDuplicateDetection: t.requiresDuplicateDetection,
      enablePartitioning: t.enablePartitioning,
      status: t.status,
      subscriptions: subs,
    });
  }

  return {
    capturedAt: new Date().toISOString(),
    namespace: namespace ?? "active-profile",
    queues,
    topics,
  };
}

export const snapshotCommand = new Command("snapshot")
  .description("Save current namespace state to a JSON file")
  .option("-o, --output <file>", "Output file", "crucible-snapshot.json")
  .option("--namespace <fqdn>", "Override namespace")
  .action(async (opts: { output: string; namespace?: string }) => {
    console.log(chalk.dim("Capturing namespace snapshot..."));
    const snap = await captureSnapshot(opts.namespace);

    await writeFile(opts.output, JSON.stringify(snap, null, 2), "utf-8");
    console.log(chalk.green(`Snapshot saved to ${opts.output}`));
    console.log(
      chalk.dim(
        `  ${snap.queues.length} queues, ${snap.topics.length} topics, ` +
          `${snap.topics.reduce((n, t) => n + t.subscriptions.length, 0)} subscriptions`
      )
    );
  });
