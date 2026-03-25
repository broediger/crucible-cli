import { Command } from "commander";
import { execFile } from "node:child_process";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";
import type { ServiceBusAdministrationClient } from "@azure/service-bus";

async function getDlqCount(
  admin: ServiceBusAdministrationClient,
  parsed: { queue?: string; topic?: string; subscription?: string }
): Promise<number> {
  if (parsed.queue) {
    const rt = await admin.getQueueRuntimeProperties(parsed.queue);
    return rt.deadLetterMessageCount;
  }
  const rt = await admin.getSubscriptionRuntimeProperties(
    parsed.topic!,
    parsed.subscription!
  );
  return rt.deadLetterMessageCount;
}

function runExecCommand(
  command: string,
  entity: string,
  dlqCount: number,
  threshold: number
): void {
  execFile(
    "/bin/sh",
    ["-c", command],
    {
      env: {
        ...process.env,
        CRUCIBLE_ENTITY: entity,
        CRUCIBLE_DLQ: String(dlqCount),
        CRUCIBLE_THRESHOLD: String(threshold),
      },
    },
    (err, stdout, stderr) => {
      if (err) console.error(chalk.red(`exec failed: ${err.message}`));
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
  );
}

async function sendNotification(
  entity: string,
  dlqCount: number,
  threshold: number
): Promise<void> {
  try {
    const notifier = await import("node-notifier");
    notifier.default.notify({
      title: "Crucible DLQ Alert",
      message: `${entity} has ${dlqCount} dead-letter messages (threshold: ${threshold})`,
      sound: true,
    });
  } catch {
    console.warn(
      chalk.yellow(
        "Desktop notification failed — node-notifier may not be supported on this platform"
      )
    );
  }
}

export const watchCommand = new Command("watch")
  .description("Watch entity DLQ count and trigger alerts when threshold is exceeded")
  .argument("<entity>", "Queue name or topic/subscription")
  .requiredOption(
    "--dlq-threshold <number>",
    "DLQ count threshold to trigger alert"
  )
  .option("--exec <command>", "Shell command to execute when threshold is crossed (use $CRUCIBLE_ENTITY, $CRUCIBLE_DLQ, $CRUCIBLE_THRESHOLD)")
  .option("--notify", "Send desktop notification when threshold is crossed")
  .option("--interval <seconds>", "Poll interval in seconds", "30")
  .option("--namespace <fqdn>", "Override namespace")
  .action(
    async (
      entity: string,
      opts: {
        dlqThreshold: string;
        exec?: string;
        notify?: boolean;
        interval: string;
        namespace?: string;
      }
    ) => {
      if (!opts.exec && !opts.notify) {
        console.error(chalk.red("Provide --exec or --notify (or both)"));
        process.exit(1);
      }

      const threshold = Number.parseInt(opts.dlqThreshold, 10);
      const intervalMs = Number.parseInt(opts.interval, 10) * 1000;
      const { admin } = await createClients(opts.namespace);
      const parsed = parseEntity(entity);

      let inAlert = false;

      console.log(
        chalk.dim(
          `Watching ${entity} — DLQ threshold: ${threshold} — poll every ${opts.interval}s`
        )
      );

      const poll = async () => {
        try {
          const dlqCount = await getDlqCount(admin, parsed);
          const now = new Date().toLocaleTimeString();

          if (dlqCount >= threshold && !inAlert) {
            inAlert = true;
            console.log(
              chalk.red(`[${now}] ALERT: ${entity} DLQ count ${dlqCount} >= threshold ${threshold}`)
            );
            if (opts.exec) runExecCommand(opts.exec, entity, dlqCount, threshold);
            if (opts.notify) await sendNotification(entity, dlqCount, threshold);
          } else if (dlqCount < threshold && inAlert) {
            inAlert = false;
            console.log(
              chalk.green(`[${now}] RESOLVED: ${entity} DLQ count ${dlqCount} < threshold ${threshold}`)
            );
          } else {
            console.log(
              chalk.dim(`[${now}] ${entity} DLQ: ${dlqCount}${inAlert ? " (in alert)" : ""}`)
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Poll error: ${msg}`));
        }
      };

      await poll();
      setInterval(poll, intervalMs);
    }
  );
