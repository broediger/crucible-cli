import { Command } from "commander";
import { exec } from "node:child_process";
import chalk from "chalk";
import { createClients } from "../lib/client.js";
import { parseEntity } from "../lib/entity.js";

export const watchCommand = new Command("watch")
  .description("Watch entity DLQ count and trigger alerts when threshold is exceeded")
  .argument("<entity>", "Queue name or topic/subscription")
  .requiredOption(
    "--dlq-threshold <number>",
    "DLQ count threshold to trigger alert"
  )
  .option("--exec <command>", "Shell command to execute when threshold is crossed")
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
        console.error(
          chalk.red("Provide --exec or --notify (or both)")
        );
        process.exit(1);
      }

      const threshold = Number.parseInt(opts.dlqThreshold, 10);
      const intervalMs = Number.parseInt(opts.interval, 10) * 1000;
      const { admin } = await createClients(opts.namespace);
      const { queue, topic, subscription } = parseEntity(entity);

      let inAlert = false;

      console.log(
        chalk.dim(
          `Watching ${entity} — DLQ threshold: ${threshold} — poll every ${opts.interval}s`
        )
      );

      const poll = async () => {
        try {
          let dlqCount: number;

          if (queue) {
            const rt = await admin.getQueueRuntimeProperties(queue);
            dlqCount = rt.deadLetterMessageCount;
          } else {
            const rt = await admin.getSubscriptionRuntimeProperties(
              topic!,
              subscription!
            );
            dlqCount = rt.deadLetterMessageCount;
          }

          const now = new Date().toLocaleTimeString();

          if (dlqCount >= threshold && !inAlert) {
            inAlert = true;
            console.log(
              chalk.red(
                `[${now}] ALERT: ${entity} DLQ count ${dlqCount} >= threshold ${threshold}`
              )
            );

            // Execute command
            if (opts.exec) {
              const cmd = opts.exec
                .replace(/\{entity\}/g, entity)
                .replace(/\{dlq\}/g, String(dlqCount))
                .replace(/\{threshold\}/g, String(threshold));

              exec(cmd, (err, stdout, stderr) => {
                if (err) {
                  console.error(
                    chalk.red(`exec failed: ${err.message}`)
                  );
                }
                if (stdout) process.stdout.write(stdout);
                if (stderr) process.stderr.write(stderr);
              });
            }

            // Desktop notification
            if (opts.notify) {
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
          } else if (dlqCount < threshold && inAlert) {
            inAlert = false;
            console.log(
              chalk.green(
                `[${now}] RESOLVED: ${entity} DLQ count ${dlqCount} < threshold ${threshold}`
              )
            );
          } else {
            console.log(
              chalk.dim(
                `[${now}] ${entity} DLQ: ${dlqCount}${inAlert ? " (in alert)" : ""}`
              )
            );
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`Poll error: ${msg}`));
        }
      };

      // Run immediately, then on interval
      await poll();
      setInterval(poll, intervalMs);
    }
  );
