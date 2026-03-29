import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp, useInput } from "ink";
import { Command } from "commander";
import { ServiceBusAdministrationClient } from "@azure/service-bus";
import { createClients } from "../lib/client.js";

interface EntityRow {
  type: string;
  name: string;
  active: number;
  dlq: number;
  scheduled: number;
  prevDlq?: number;
}

async function fetchEntities(
  admin: ServiceBusAdministrationClient,
  entityFilter?: string
): Promise<EntityRow[]> {
  const entities: EntityRow[] = [];

  for await (const queue of admin.listQueues()) {
    if (entityFilter && !queue.name.includes(entityFilter)) continue;
    const rt = await admin.getQueueRuntimeProperties(queue.name);
    entities.push({
      type: "queue",
      name: queue.name,
      active: rt.activeMessageCount,
      dlq: rt.deadLetterMessageCount,
      scheduled: rt.scheduledMessageCount,
    });
  }

  for await (const topic of admin.listTopics()) {
    for await (const sub of admin.listSubscriptions(topic.name)) {
      const name = `${topic.name}/${sub.subscriptionName}`;
      if (entityFilter && !name.includes(entityFilter)) continue;
      const rt = await admin.getSubscriptionRuntimeProperties(
        topic.name,
        sub.subscriptionName
      );
      entities.push({
        type: "topic/sub",
        name,
        active: rt.activeMessageCount,
        dlq: rt.deadLetterMessageCount,
        scheduled: 0,
      });
    }
  }

  return entities;
}

interface DashboardProps {
  admin: ServiceBusAdministrationClient;
  intervalMs: number;
  entityFilter?: string;
}

function Dashboard({ admin, intervalMs, entityFilter }: DashboardProps) {
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [prevDlqs, setPrevDlqs] = useState<Map<string, number>>(new Map());
  const { exit } = useApp();

  useInput((input) => {
    if (input === "q") exit();
  });

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const rows = await fetchEntities(admin, entityFilter);
        if (!active) return;

        // Track DLQ growth
        const newPrevDlqs = new Map<string, number>();
        for (const r of rows) {
          r.prevDlq = prevDlqs.get(r.name);
          newPrevDlqs.set(r.name, r.dlq);
        }
        setPrevDlqs(newPrevDlqs);

        // Sort by DLQ descending
        rows.sort((a, b) => b.dlq - a.dlq);
        setEntities(rows);
        setError(null);
        setLastRefresh(new Date().toLocaleTimeString());
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [admin, intervalMs, entityFilter]);

  const colW = { type: 10, name: 40, active: 10, dlq: 10, sched: 10, trend: 6 };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Crucible Monitor
        </Text>
        <Text dimColor>
          {" "}
          — refreshing every {intervalMs / 1000}s — {lastRefresh} — press q to
          quit
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {/* Header */}
      <Box>
        <Box width={colW.type}>
          <Text bold>TYPE</Text>
        </Box>
        <Box width={colW.name}>
          <Text bold>NAME</Text>
        </Box>
        <Box width={colW.active}>
          <Text bold>ACTIVE</Text>
        </Box>
        <Box width={colW.dlq}>
          <Text bold>DLQ</Text>
        </Box>
        <Box width={colW.sched}>
          <Text bold>SCHED</Text>
        </Box>
        <Box width={colW.trend}>
          <Text bold>TREND</Text>
        </Box>
      </Box>

      {/* Rows */}
      {entities.map((e) => {
        let dlqColor: string = "green";
        if (e.dlq > 10) dlqColor = "red";
        else if (e.dlq > 0) dlqColor = "yellow";

        const growing = e.prevDlq !== undefined && e.dlq > e.prevDlq;
        const shrinking = e.prevDlq !== undefined && e.dlq < e.prevDlq;

        let trend = "";
        let trendColor: string | undefined;
        if (growing) {
          trend = "^ UP";
          trendColor = "red";
        } else if (shrinking) {
          trend = "v DN";
          trendColor = "green";
        }

        return (
          <Box key={e.name}>
            <Box width={colW.type}>
              <Text dimColor>{e.type}</Text>
            </Box>
            <Box width={colW.name}>
              <Text>{e.name}</Text>
            </Box>
            <Box width={colW.active}>
              <Text>{e.active}</Text>
            </Box>
            <Box width={colW.dlq}>
              <Text color={dlqColor} bold={e.dlq > 0}>
                {e.dlq}
              </Text>
            </Box>
            <Box width={colW.sched}>
              <Text>{e.scheduled}</Text>
            </Box>
            <Box width={colW.trend}>
              <Text color={trendColor} bold>
                {trend}
              </Text>
            </Box>
          </Box>
        );
      })}

      {entities.length === 0 && !error && <Text dimColor>Loading...</Text>}
    </Box>
  );
}

export const monitorCommand = new Command("monitor")
  .description("Live TUI dashboard for Service Bus entities")
  .option("--entity <name>", "Filter to entities matching this name")
  .option("--interval <seconds>", "Poll interval in seconds", "5")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (opts: { entity?: string; interval: string; namespace?: string }) => {
      const { admin } = await createClients(opts.namespace);
      const intervalMs = Number.parseInt(opts.interval, 10) * 1000;

      render(
        <Dashboard
          admin={admin}
          intervalMs={intervalMs}
          entityFilter={opts.entity}
        />
      );
    }
  );
