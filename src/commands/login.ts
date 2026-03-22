import { Command } from "commander";
import chalk from "chalk";
import { InteractiveBrowserCredential } from "@azure/identity";
import { loadConfig, saveConfig } from "../lib/config.js";

export const loginCommand = new Command("login")
  .description("Login to Azure via interactive browser flow")
  .option("--tenant <id>", "Azure AD tenant ID")
  .option("--profile <name>", "Save as named profile", "default")
  .action(
    async (opts: { tenant?: string; profile: string }) => {
      console.log(chalk.dim("Opening browser for Azure login..."));

      const credential = new InteractiveBrowserCredential({
        tenantId: opts.tenant,
      });

      try {
        // Force an interactive login by requesting a Service Bus token
        const token = await credential.getToken(
          "https://servicebus.azure.net/.default"
        );

        if (!token) {
          console.error(chalk.red("Login failed — no token received"));
          process.exit(1);
        }

        console.log(chalk.green("Login successful"));

        // If a tenant was specified, save it as a profile using Entra ID auth
        if (opts.tenant) {
          const config = await loadConfig();
          const existing = config.profiles.findIndex(
            (p) => p.name === opts.profile
          );

          const profile = {
            name: opts.profile,
            namespace: undefined as string | undefined,
            connectionString: undefined as string | undefined,
          };

          if (existing >= 0) {
            // Keep existing namespace/connectionString, just confirm login works
            console.log(
              chalk.dim(
                `Profile "${opts.profile}" already exists — login verified`
              )
            );
          } else {
            config.profiles.push(profile);
            if (config.profiles.length === 1) {
              config.activeProfile = opts.profile;
            }
            await saveConfig(config);
            console.log(
              chalk.dim(
                `Profile "${opts.profile}" created. Run: crucible config add ${opts.profile} --namespace <fqdn>`
              )
            );
          }
        }

        console.log(
          chalk.dim(
            "DefaultAzureCredential will now pick up your cached login for future commands."
          )
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        console.error(chalk.red(`Login failed: ${message}`));
        process.exit(1);
      }
    }
  );
