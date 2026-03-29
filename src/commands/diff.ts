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

interface Named {
  name: string;
}

/**
 * Generic diff for named entities. Detects added, removed, and changed items.
 * @param prefix   - path prefix for diff entries (e.g. "queue" or "topic/orders")
 * @param before   - entities in the baseline
 * @param after    - entities in the current state
 * @param keyFn    - extract the map key from an entity
 * @param compareFn - produce diff entries for two matched entities (optional)
 */
function diffNamedEntities<T extends Named>(
  prefix: string,
  before: T[],
  after: T[],
  keyFn: (item: T) => string,
  compareFn?: (path: string, b: T, a: T) => DiffEntry[]
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const beforeMap = new Map(before.map((item) => [keyFn(item), item]));
  const afterMap = new Map(after.map((item) => [keyFn(item), item]));

  for (const name of afterMap.keys()) {
    if (!beforeMap.has(name)) {
      diffs.push({ type: "added", path: `${prefix}/${name}` });
    }
  }

  for (const [name, b] of beforeMap) {
    const a = afterMap.get(name);
    if (!a) {
      diffs.push({ type: "removed", path: `${prefix}/${name}` });
    } else if (compareFn) {
      diffs.push(...compareFn(`${prefix}/${name}`, b, a));
    }
  }

  return diffs;
}

/** Compare all own properties of two objects (skipping listed keys). */
function diffProperties(
  path: string,
  before: object,
  after: object,
  skip: string[]
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (skip.includes(key)) continue;
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      diffs.push({
        type: "changed",
        path: `${path}.${key}`,
        before: b[key],
        after: a[key],
      });
    }
  }
  return diffs;
}

function diffQueues(
  before: QueueSnapshot[],
  after: QueueSnapshot[]
): DiffEntry[] {
  return diffNamedEntities(
    "queue",
    before,
    after,
    (q) => q.name,
    (path, b, a) => diffProperties(path, b, a, ["name"])
  );
}

function diffTopics(
  before: TopicSnapshot[],
  after: TopicSnapshot[]
): DiffEntry[] {
  return diffNamedEntities(
    "topic",
    before,
    after,
    (t) => t.name,
    (path, b, a) => [
      ...diffProperties(path, b, a, ["name", "subscriptions"]),
      ...diffSubscriptions(b.name, b.subscriptions, a.subscriptions),
    ]
  );
}

function diffSubscriptions(
  topicName: string,
  before: SubscriptionSnapshot[],
  after: SubscriptionSnapshot[]
): DiffEntry[] {
  return diffNamedEntities(
    `topic/${topicName}`,
    before,
    after,
    (s) => s.name,
    (path, b, a) => [
      ...diffProperties(path, b, a, ["name", "rules"]),
      ...diffRules(topicName, b.name, b.rules, a.rules),
    ]
  );
}

function diffRules(
  topicName: string,
  subName: string,
  before: RuleSnapshot[],
  after: RuleSnapshot[]
): DiffEntry[] {
  return diffNamedEntities(
    `topic/${topicName}/${subName}/rule`,
    before,
    after,
    (r) => r.name,
    (path, b, a) => diffProperties(path, b, a, ["name"])
  );
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
  .argument(
    "[b]",
    "Second namespace FQDN (for namespace-to-namespace comparison)"
  )
  .option("--json", "Output as JSON")
  .option(
    "--namespace <fqdn>",
    "Override namespace (when comparing against a snapshot file)"
  )
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
