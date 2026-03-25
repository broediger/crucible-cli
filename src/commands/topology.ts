import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";

interface RuleInfo {
  name: string;
  filter?: string;
}

interface SubInfo {
  name: string;
  rules: RuleInfo[];
}

interface TopicInfo {
  name: string;
  subscriptions: SubInfo[];
}

interface QueueInfo {
  name: string;
}

interface Topology {
  queues: QueueInfo[];
  topics: TopicInfo[];
}

interface SqlRuleFilter {
  sqlExpression: string;
}

interface CorrelationRuleFilter {
  correlationId?: string;
  messageId?: string;
  to?: string;
  replyTo?: string;
  label?: string;
  sessionId?: string;
  contentType?: string;
  properties?: Record<string, unknown>;
  applicationProperties?: Record<string, unknown>;
}

function isSqlFilter(f: unknown): f is SqlRuleFilter {
  return typeof f === "object" && f !== null && "sqlExpression" in f;
}

function isCorrelationFilter(f: unknown): f is CorrelationRuleFilter {
  return typeof f === "object" && f !== null &&
    ("correlationId" in f || "label" in f || "contentType" in f || "properties" in f);
}

const CORRELATION_FIELDS: (keyof CorrelationRuleFilter)[] = [
  "correlationId", "messageId", "to", "replyTo",
  "label", "sessionId", "contentType",
];

function formatSqlFilter(f: SqlRuleFilter): string {
  return f.sqlExpression === "1=1" ? "TrueFilter" : f.sqlExpression;
}

function formatCorrelationFilter(f: CorrelationRuleFilter): string {
  const parts: string[] = CORRELATION_FIELDS
    .filter((k) => f[k])
    .map((k) => `${k}=${f[k]}`);

  const props = f.properties || f.applicationProperties || {};
  for (const [k, v] of Object.entries(props)) {
    parts.push(`${k}=${v}`);
  }

  return parts.length > 0 ? parts.join(", ") : "CorrelationFilter";
}

function formatFilter(rule: { filter?: unknown }): string {
  const f = rule.filter;
  if (!f) return "";
  if (isSqlFilter(f)) return formatSqlFilter(f);
  if (isCorrelationFilter(f)) return formatCorrelationFilter(f);
  return "";
}

async function fetchTopology(namespace?: string, includeRules?: boolean): Promise<Topology> {
  const { admin } = await createClients(namespace);
  const queues: QueueInfo[] = [];
  const topics: TopicInfo[] = [];

  for await (const q of admin.listQueues()) {
    queues.push({ name: q.name });
  }

  for await (const t of admin.listTopics()) {
    const subs: SubInfo[] = [];

    for await (const s of admin.listSubscriptions(t.name)) {
      const rules: RuleInfo[] = [];
      for await (const r of admin.listRules(t.name, s.subscriptionName)) {
        if (includeRules) {
          rules.push({ name: r.name, filter: formatFilter(r) });
        } else {
          rules.push({ name: r.name });
        }
      }
      subs.push({ name: s.subscriptionName, rules });
    }

    topics.push({ name: t.name, subscriptions: subs });
  }

  return { queues, topics };
}

/** Return the tree branch/continuation prefixes for an item in a list. */
function treePrefixes(
  parent: string,
  index: number,
  total: number
): { prefix: string; cont: string } {
  const isLast = index === total - 1;
  return {
    prefix: isLast ? `${parent}└─` : `${parent}├─`,
    cont: isLast ? `${parent}  ` : `${parent}│ `,
  };
}

function renderRulesTree(rules: RuleInfo[], cont: string, showFilter: boolean): void {
  for (let ri = 0; ri < rules.length; ri++) {
    const rule = rules[ri];
    const r = treePrefixes(cont, ri, rules.length);
    console.log(`${r.prefix} ${chalk.dim(rule.name)}`);
    if (showFilter && rule.filter) {
      console.log(`${r.cont}${chalk.gray("→")} ${chalk.blue(rule.filter)}`);
    }
  }
}

function renderSubscriptionsTree(
  subs: SubInfo[],
  cont: string,
  showRules: boolean
): void {
  for (let si = 0; si < subs.length; si++) {
    const s = treePrefixes(cont, si, subs.length);
    console.log(`${s.prefix} ${chalk.yellow(subs[si].name)}`);
    renderRulesTree(subs[si].rules, s.cont, showRules);
  }
}

function renderTree(topo: Topology, showRules: boolean): void {
  if (topo.queues.length > 0) {
    console.log(chalk.bold("Queues"));
    for (let i = 0; i < topo.queues.length; i++) {
      const q = treePrefixes("  ", i, topo.queues.length);
      console.log(`${q.prefix} ${chalk.cyan(topo.queues[i].name)}`);
    }
    console.log();
  }

  if (topo.topics.length > 0) {
    console.log(chalk.bold("Topics"));
    for (let ti = 0; ti < topo.topics.length; ti++) {
      const t = treePrefixes("  ", ti, topo.topics.length);
      console.log(`${t.prefix} ${chalk.magenta(topo.topics[ti].name)}`);
      renderSubscriptionsTree(topo.topics[ti].subscriptions, t.cont, showRules);
    }
  }

  if (topo.queues.length === 0 && topo.topics.length === 0) {
    console.log(chalk.dim("No entities found"));
  }
}

function getRuleLabel(rule: RuleInfo, showFilter: boolean): string | null {
  if (showFilter) {
    if (rule.name === "$Default" && (!rule.filter || rule.filter === "TrueFilter")) return null;
    return rule.filter || rule.name;
  }
  if (rule.name === "$Default") return null;
  return rule.name;
}

function renderMermaid(topo: Topology, showRules: boolean): void {
  const lines: string[] = ["graph LR"];

  for (const q of topo.queues) {
    lines.push(`  ${sanitize(q.name)}[["${q.name} (queue)"]]`);
  }

  for (const t of topo.topics) {
    const tid = sanitize(t.name);
    lines.push(`  ${tid}(("${t.name}"))`);

    for (const s of t.subscriptions) {
      const sid = sanitize(`${t.name}_${s.name}`);
      lines.push(`  ${tid} --> ${sid}["${s.name}"]`);

      for (const r of s.rules) {
        const label = getRuleLabel(r, showRules);
        if (!label) continue;
        const rid = sanitize(`${t.name}_${s.name}_${r.name}`);
        lines.push(`  ${sid} -. "${label}" .-> ${rid}((filter))`);
      }
    }
  }

  console.log(lines.join("\n"));
}

function sanitize(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

export const topologyCommand = new Command("topology")
  .description(
    "Show namespace topology (queues, topics, subscriptions, rules)"
  )
  .option("--format <type>", "Output format: tree, json, mermaid", "tree")
  .option("--rules", "Show filter expressions for each subscription rule")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: { format: string; rules?: boolean; namespace?: string }) => {
      const topo = await fetchTopology(opts.namespace, opts.rules);

      switch (opts.format) {
        case "json":
          console.log(JSON.stringify(topo, null, 2));
          break;
        case "mermaid":
          renderMermaid(topo, !!opts.rules);
          break;
        default:
          renderTree(topo, !!opts.rules);
          break;
      }
    }
  );
