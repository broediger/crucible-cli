import { Command } from "commander";
import chalk from "chalk";
import { createClients } from "../lib/client.js";

interface SubInfo {
  name: string;
  rules: string[];
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

async function fetchTopology(namespace?: string): Promise<Topology> {
  const { admin } = await createClients(namespace);
  const queues: QueueInfo[] = [];
  const topics: TopicInfo[] = [];

  for await (const q of admin.listQueues()) {
    queues.push({ name: q.name });
  }

  for await (const t of admin.listTopics()) {
    const subs: SubInfo[] = [];

    for await (const s of admin.listSubscriptions(t.name)) {
      const rules: string[] = [];
      for await (const r of admin.listRules(t.name, s.subscriptionName)) {
        rules.push(r.name);
      }
      subs.push({ name: s.subscriptionName, rules });
    }

    topics.push({ name: t.name, subscriptions: subs });
  }

  return { queues, topics };
}

function renderTree(topo: Topology): void {
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

        for (let ri = 0; ri < s.rules.length; ri++) {
          const rLast = ri === s.rules.length - 1;
          const rPrefix = rLast ? `${sCont}└─` : `${sCont}├─`;
          console.log(`${rPrefix} ${chalk.dim(s.rules[ri])}`);
        }
      }
    }
  }

  if (topo.queues.length === 0 && topo.topics.length === 0) {
    console.log(chalk.dim("No entities found"));
  }
}

function renderMermaid(topo: Topology): void {
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

      for (const r of s.rules) {
        if (r === "$Default") continue;
        const rid = sanitize(`${t.name}_${s.name}_${r}`);
        lines.push(`  ${sid} -. "${r}" .-> ${rid}((filter))`);
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
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: { format: string; namespace?: string }) => {
      const topo = await fetchTopology(opts.namespace);

      switch (opts.format) {
        case "json":
          console.log(JSON.stringify(topo, null, 2));
          break;
        case "mermaid":
          renderMermaid(topo);
          break;
        default:
          renderTree(topo);
          break;
      }
    }
  );
