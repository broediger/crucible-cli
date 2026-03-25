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

function renderTree(topo: Topology, showRules: boolean): void {
  // Queues
  if (topo.queues.length > 0) {
    console.log(chalk.bold("Queues"));
    for (let i = 0; i < topo.queues.length; i++) {
      const isLast = i === topo.queues.length - 1;
      const prefix = isLast ? "  └─" : "  ├─";
      console.log(`${prefix} ${chalk.cyan(topo.queues[i].name)}`);
    }
    console.log();
  }

  // Topics
  if (topo.topics.length > 0) {
    console.log(chalk.bold("Topics"));
    for (let ti = 0; ti < topo.topics.length; ti++) {
      const t = topo.topics[ti];
      const tLast = ti === topo.topics.length - 1;
      const tPrefix = tLast ? "  └─" : "  ├─";
      const tCont = tLast ? "    " : "  │ ";

      console.log(`${tPrefix} ${chalk.magenta(t.name)}`);

      for (let si = 0; si < t.subscriptions.length; si++) {
        const s = t.subscriptions[si];
        const sLast = si === t.subscriptions.length - 1;
        const sPrefix = sLast ? `${tCont}└─` : `${tCont}├─`;
        const sCont = sLast ? `${tCont}  ` : `${tCont}│ `;

        console.log(`${sPrefix} ${chalk.yellow(s.name)}`);

        if (showRules) {
          for (let ri = 0; ri < s.rules.length; ri++) {
            const rule = s.rules[ri];
            const rLast = ri === s.rules.length - 1;
            const rPrefix = rLast ? `${sCont}└─` : `${sCont}├─`;
            const rCont = rLast ? `${sCont}  ` : `${sCont}│ `;
            console.log(`${rPrefix} ${chalk.dim(rule.name)}`);
            if (rule.filter) {
              console.log(`${rCont}${chalk.gray("→")} ${chalk.blue(rule.filter)}`);
            }
          }
        } else {
          for (let ri = 0; ri < s.rules.length; ri++) {
            const rLast = ri === s.rules.length - 1;
            const rPrefix = rLast ? `${sCont}└─` : `${sCont}├─`;
            console.log(`${rPrefix} ${chalk.dim(s.rules[ri].name)}`);
          }
        }
      }
    }
  }

  if (topo.queues.length === 0 && topo.topics.length === 0) {
    console.log(chalk.dim("No entities found"));
  }
}

function renderMermaid(topo: Topology, showRules: boolean): void {
  const lines: string[] = ["graph LR"];

  // Queues
  for (const q of topo.queues) {
    const id = sanitize(q.name);
    lines.push(`  ${id}[["${q.name} (queue)"]]`);
  }

  // Topics → Subscriptions → Rules
  for (const t of topo.topics) {
    const tid = sanitize(t.name);
    lines.push(`  ${tid}(("${t.name}"))`);

    for (const s of t.subscriptions) {
      const sid = sanitize(`${t.name}_${s.name}`);
      lines.push(`  ${tid} --> ${sid}["${s.name}"]`);

      if (showRules) {
        for (const r of s.rules) {
          if (r.name === "$Default" && (!r.filter || r.filter === "TrueFilter")) continue;
          const rid = sanitize(`${t.name}_${s.name}_${r.name}`);
          const label = r.filter || r.name;
          lines.push(`  ${sid} -. "${label}" .-> ${rid}((filter))`);
        }
      } else {
        for (const r of s.rules) {
          if (r.name === "$Default") continue;
          const rid = sanitize(`${t.name}_${s.name}_${r.name}`);
          lines.push(`  ${sid} -. "${r.name}" .-> ${rid}((filter))`);
        }
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
