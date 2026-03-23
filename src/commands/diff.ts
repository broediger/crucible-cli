import { Command } from "commander";
import { readFile } from "node:fs/promises";
import chalk from "chalk";
import {
  captureSnapshot,
  type NamespaceSnapshot,
  type QueueSnapshot,
  type TopicSnapshot,
  type SubscriptionSnapshot,
  type RuleSnapshot,
} from "./snapshot.js";

interface DiffEntry {
  type: "added" | "removed" | "changed";
  path: string;
  before?: unknown;
  after?: unknown;
}

function diffQueues(
  before: QueueSnapshot[],
  after: QueueSnapshot[]
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const beforeMap = new Map(before.map((q) => [q.name, q]));
  const afterMap = new Map(after.map((q) => [q.name, q]));

  for (const [name, q] of afterMap) {
    if (!beforeMap.has(name)) {
      diffs.push({ type: "added", path: `queue/${name}` });
    }
  }
  for (const [name, q] of beforeMap) {
    if (!afterMap.has(name)) {
      diffs.push({ type: "removed", path: `queue/${name}` });
    } else {
      const a = afterMap.get(name)!;
      for (const key of Object.keys(q) as Array<keyof QueueSnapshot>) {
        if (key === "name") continue;
        if (JSON.stringify(q[key]) !== JSON.stringify(a[key])) {
          diffs.push({
            type: "changed",
            path: `queue/${name}.${key}`,
            before: q[key],
            after: a[key],
          });
        }
      }
    }
  }
  return diffs;
}

function diffTopics(
  before: TopicSnapshot[],
  after: TopicSnapshot[]
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const beforeMap = new Map(before.map((t) => [t.name, t]));
  const afterMap = new Map(after.map((t) => [t.name, t]));

  for (const [name] of afterMap) {
    if (!beforeMap.has(name)) {
      diffs.push({ type: "added", path: `topic/${name}` });
    }
  }
  for (const [name, t] of beforeMap) {
    if (!afterMap.has(name)) {
      diffs.push({ type: "removed", path: `topic/${name}` });
      continue;
    }
    const a = afterMap.get(name)!;

    // Topic-level config
    for (const key of Object.keys(t) as Array<keyof TopicSnapshot>) {
      if (key === "name" || key === "subscriptions") continue;
      if (JSON.stringify(t[key]) !== JSON.stringify(a[key])) {
        diffs.push({
          type: "changed",
          path: `topic/${name}.${key}`,
          before: t[key],
          after: a[key],
        });
      }
    }

    // Subscriptions
    diffs.push(...diffSubscriptions(name, t.subscriptions, a.subscriptions));
  }
  return diffs;
}

function diffSubscriptions(
  topicName: string,
  before: SubscriptionSnapshot[],
  after: SubscriptionSnapshot[]
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const beforeMap = new Map(before.map((s) => [s.name, s]));
  const afterMap = new Map(after.map((s) => [s.name, s]));

  for (const [name] of afterMap) {
    if (!beforeMap.has(name)) {
      diffs.push({ type: "added", path: `topic/${topicName}/${name}` });
    }
  }
  for (const [name, s] of beforeMap) {
    if (!afterMap.has(name)) {
      diffs.push({ type: "removed", path: `topic/${topicName}/${name}` });
      continue;
    }
    const a = afterMap.get(name)!;

    for (const key of Object.keys(s) as Array<keyof SubscriptionSnapshot>) {
      if (key === "name" || key === "rules") continue;
      if (JSON.stringify(s[key]) !== JSON.stringify(a[key])) {
        diffs.push({
          type: "changed",
          path: `topic/${topicName}/${name}.${key}`,
          before: s[key],
          after: a[key],
        });
      }
    }

    // Rules
    diffs.push(...diffRules(topicName, name, s.rules, a.rules));
  }
  return diffs;
}

function diffRules(
  topicName: string,
  subName: string,
  before: RuleSnapshot[],
  after: RuleSnapshot[]
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const prefix = `topic/${topicName}/${subName}/rule`;
  const beforeMap = new Map(before.map((r) => [r.name, r]));
  const afterMap = new Map(after.map((r) => [r.name, r]));

  for (const [name] of afterMap) {
    if (!beforeMap.has(name)) {
      diffs.push({ type: "added", path: `${prefix}/${name}` });
    }
  }
  for (const [name, r] of beforeMap) {
    if (!afterMap.has(name)) {
      diffs.push({ type: "removed", path: `${prefix}/${name}` });
    } else {
      const a = afterMap.get(name)!;
      if (JSON.stringify(r.filter) !== JSON.stringify(a.filter)) {
        diffs.push({
          type: "changed",
          path: `${prefix}/${name}.filter`,
          before: r.filter,
          after: a.filter,
        });
      }
      if (JSON.stringify(r.action) !== JSON.stringify(a.action)) {
        diffs.push({
          type: "changed",
          path: `${prefix}/${name}.action`,
          before: r.action,
          after: a.action,
        });
      }
    }
  }
  return diffs;
}

function renderDiffs(diffs: DiffEntry[], json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(diffs, null, 2));
    return;
  }

  if (diffs.length === 0) {
    console.log(chalk.green("No differences found"));
    return;
  }

  console.log(chalk.bold(`${diffs.length} difference(s):\n`));
  for (const d of diffs) {
    switch (d.type) {
      case "added":
        console.log(chalk.green(`  + ${d.path}`));
        break;
      case "removed":
        console.log(chalk.red(`  - ${d.path}`));
        break;
      case "changed":
        console.log(chalk.yellow(`  ~ ${d.path}`));
        console.log(chalk.red(`      before: ${JSON.stringify(d.before)}`));
        console.log(chalk.green(`      after:  ${JSON.stringify(d.after)}`));
        break;
    }
  }
}

export const diffCommand = new Command("diff")
  .description(
    "Compare current namespace state against a snapshot file, or compare two namespaces"
  )
  .argument("<a>", "Snapshot file or namespace FQDN")
  .argument("[b]", "Second namespace FQDN (for namespace-to-namespace comparison)")
  .option("--json", "Output as JSON")
  .option("--namespace <fqdn>", "Override namespace (when comparing against a snapshot file)")
  .action(
    async (
      a: string,
      b: string | undefined,
      opts: { json?: boolean; namespace?: string }
    ) => {
      let before: NamespaceSnapshot;
      let after: NamespaceSnapshot;

      if (b) {
        // Compare two live namespaces
        console.error(chalk.dim(`Capturing snapshot of ${a}...`));
        before = await captureSnapshot(a);
        console.error(chalk.dim(`Capturing snapshot of ${b}...`));
        after = await captureSnapshot(b);
      } else {
        // Compare snapshot file against live namespace
        const raw = await readFile(a, "utf-8");
        before = JSON.parse(raw) as NamespaceSnapshot;
        console.error(
          chalk.dim(
            `Comparing snapshot from ${before.capturedAt} against live namespace...`
          )
        );
        after = await captureSnapshot(opts.namespace);
      }

      const diffs = [
        ...diffQueues(before.queues, after.queues),
        ...diffTopics(before.topics, after.topics),
      ];

      renderDiffs(diffs, opts.json);

      // Exit code 2 if there are differences (useful for CI)
      if (diffs.length > 0) {
        process.exitCode = 2;
      }
    }
  );
