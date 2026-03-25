import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { createClients } from "../lib/client.js";
import type { ServiceBusAdministrationClient } from "@azure/service-bus";

// Azure Service Bus pricing (Standard tier, approximate USD)
// https://azure.microsoft.com/en-us/pricing/details/service-bus/
const PRICING = {
  basePerMonth: 10.0, // Base charge per namespace (Standard)
  perMillionOps: 0.0135, // Per million messaging operations
  perTopicOrQueue: 0.01, // Approximate per entity per day
};

interface EntityCost {
  type: string;
  name: string;
  activeMessages: number;
  dlqMessages: number;
  estimatedOpsPerDay: number;
  monthlyCost: number;
  issues: string[];
}

function estimateMonthlyCost(opsPerDay: number, entityCount: number): number {
  return (
    PRICING.perTopicOrQueue * 30 * entityCount +
    (opsPerDay * 30 * PRICING.perMillionOps) / 1_000_000
  );
}

function detectQueueIssues(
  totalMessages: number,
  activeCount: number,
  dlqCount: number
): string[] {
  const issues: string[] = [];
  if (totalMessages === 0) issues.push("empty — possibly unused");
  if (dlqCount > activeCount && dlqCount > 10) {
    issues.push("DLQ larger than active — check consumer health");
  }
  return issues;
}

function detectTopicIssues(
  totalMessages: number,
  subCount: number,
  activeCount: number,
  dlqCount: number
): string[] {
  const issues: string[] = [];
  if (totalMessages === 0 && subCount === 0)
    issues.push("no subscriptions — unused topic");
  if (totalMessages === 0 && subCount > 0)
    issues.push("all subscriptions empty — possibly unused");
  if (subCount > 10)
    issues.push(`${subCount} subscriptions — fan-out may be expensive`);
  if (dlqCount > activeCount && dlqCount > 10)
    issues.push("DLQ larger than active across subscriptions");
  return issues;
}

async function gatherQueueCosts(
  admin: ServiceBusAdministrationClient
): Promise<EntityCost[]> {
  const entities: EntityCost[] = [];
  for await (const queue of admin.listQueues()) {
    const rt = await admin.getQueueRuntimeProperties(queue.name);
    const totalMessages =
      rt.activeMessageCount + rt.deadLetterMessageCount + rt.scheduledMessageCount;
    const estimatedOpsPerDay = Math.max(totalMessages * 10, 100);

    entities.push({
      type: "queue",
      name: queue.name,
      activeMessages: rt.activeMessageCount,
      dlqMessages: rt.deadLetterMessageCount,
      estimatedOpsPerDay,
      monthlyCost: estimateMonthlyCost(estimatedOpsPerDay, 1),
      issues: detectQueueIssues(
        totalMessages,
        rt.activeMessageCount,
        rt.deadLetterMessageCount
      ),
    });
  }
  return entities;
}

async function gatherTopicCosts(
  admin: ServiceBusAdministrationClient
): Promise<EntityCost[]> {
  const entities: EntityCost[] = [];
  for await (const topic of admin.listTopics()) {
    let topicTotalActive = 0;
    let topicTotalDlq = 0;
    let subCount = 0;

    for await (const sub of admin.listSubscriptions(topic.name)) {
      const rt = await admin.getSubscriptionRuntimeProperties(
        topic.name,
        sub.subscriptionName
      );
      topicTotalActive += rt.activeMessageCount;
      topicTotalDlq += rt.deadLetterMessageCount;
      subCount++;
    }

    const totalMessages = topicTotalActive + topicTotalDlq;
    const estimatedOpsPerDay = Math.max(totalMessages * 10, 100) * subCount;

    entities.push({
      type: "topic",
      name: `${topic.name} (${subCount} subs)`,
      activeMessages: topicTotalActive,
      dlqMessages: topicTotalDlq,
      estimatedOpsPerDay,
      monthlyCost: estimateMonthlyCost(estimatedOpsPerDay, 1 + subCount),
      issues: detectTopicIssues(
        totalMessages,
        subCount,
        topicTotalActive,
        topicTotalDlq
      ),
    });
  }
  return entities;
}

function renderSummary(totalMonthlyCost: number): void {
  console.log(chalk.bold("Estimated Monthly Cost\n"));
  console.log(
    `  Namespace base:  ${chalk.cyan("$" + PRICING.basePerMonth.toFixed(2))}`
  );
  console.log(
    `  Entity + ops:    ${chalk.cyan(
      "$" + (totalMonthlyCost - PRICING.basePerMonth).toFixed(2)
    )}`
  );
  console.log(
    `  ${chalk.bold(
      "Total:           $" + totalMonthlyCost.toFixed(2) + "/month"
    )}`
  );
  console.log(
    chalk.dim(
      "\n  * Estimates based on Standard tier pricing and current message counts."
    )
  );
  console.log(
    chalk.dim("    Actual costs depend on throughput, tier, and region.\n")
  );
}

function renderTable(entities: EntityCost[]): void {
  const table = new Table({
    head: ["Type", "Name", "Active", "DLQ", "Est. $/mo"].map((h) =>
      chalk.bold(h)
    ),
  });

  for (const e of entities) {
    table.push([
      chalk.dim(e.type),
      e.name,
      e.activeMessages.toString(),
      e.dlqMessages > 0 ? chalk.yellow(e.dlqMessages.toString()) : "0",
      "$" + e.monthlyCost.toFixed(2),
    ]);
  }
  console.log(table.toString());
}

function renderOptimizations(entities: EntityCost[]): void {
  const suggestions = entities.filter((e) => e.issues.length > 0);
  if (suggestions.length === 0) {
    console.log(chalk.green("\nNo optimization suggestions."));
    return;
  }
  console.log(chalk.bold("\nOptimization Suggestions:\n"));
  for (const e of suggestions) {
    for (const issue of e.issues) {
      console.log(`  ${chalk.yellow("!")} ${chalk.bold(e.name)} — ${issue}`);
    }
  }
}

export const costsCommand = new Command("costs")
  .description("Estimate monthly cost and surface optimization opportunities")
  .option("--optimize", "Show optimization suggestions")
  .option("--json", "Output as JSON")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: {
      optimize?: boolean;
      json?: boolean;
      namespace?: string;
    }) => {
      const { admin } = await createClients(opts.namespace);
      const entities = [
        ...(await gatherQueueCosts(admin)),
        ...(await gatherTopicCosts(admin)),
      ];

      const totalMonthlyCost =
        PRICING.basePerMonth +
        entities.reduce((sum, e) => sum + e.monthlyCost, 0);

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              estimatedMonthlyCost: totalMonthlyCost,
              baseCharge: PRICING.basePerMonth,
              entities,
            },
            null,
            2
          )
        );
        return;
      }

      renderSummary(totalMonthlyCost);
      renderTable(entities);
      if (opts.optimize) renderOptimizations(entities);
    }
  );
