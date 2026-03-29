import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "../lib/config.js";

export const configCommand = new Command("config").description(
  "Manage namespace profiles"
);

configCommand
  .command("add <name>")
  .description("Add a namespace profile")
  .option("--connection-string <string>", "Service Bus connection string")
  .option("--namespace <fqdn>", "Service Bus namespace FQDN (for Entra ID)")
  .action(
    async (
      name: string,
      opts: { connectionString?: string; namespace?: string }
    ) => {
      if (!opts.connectionString && !opts.namespace) {
        console.error(chalk.red("Provide --connection-string or --namespace"));
        process.exit(1);
      }

      const config = await loadConfig();
      const existing = config.profiles.findIndex((p) => p.name === name);

      const profile = {
        name,
        connectionString: opts.connectionString,
        namespace: opts.namespace,
      };

      if (existing >= 0) {
        config.profiles[existing] = profile;
        console.log(chalk.yellow(`Updated profile "${name}"`));
      } else {
        config.profiles.push(profile);
        console.log(chalk.green(`Added profile "${name}"`));
      }

      if (config.profiles.length === 1) {
        config.activeProfile = name;
      }

      await saveConfig(config);
    }
  );

configCommand
  .command("list")
  .description("List all configured namespaces")
  .action(async () => {
    const config = await loadConfig();

    if (config.profiles.length === 0) {
      console.log(
        chalk.dim("No profiles configured. Run: crucible config add <name>")
      );
      return;
    }

    for (const p of config.profiles) {
      const active = p.name === config.activeProfile ? chalk.green(" ●") : "  ";
      const target = p.connectionString
        ? chalk.dim("(connection string)")
        : chalk.dim(p.namespace ?? "");
      console.log(`${active} ${p.name}  ${target}`);
    }
  });

configCommand
  .command("use <name>")
  .description("Set the active namespace profile")
  .action(async (name: string) => {
    const config = await loadConfig();
    const profile = config.profiles.find((p) => p.name === name);

    if (!profile) {
      console.error(chalk.red(`Profile "${name}" not found`));
      process.exit(1);
    }

    config.activeProfile = name;
    await saveConfig(config);
    console.log(chalk.green(`Active profile: ${name}`));
  });

configCommand
  .command("remove <name>")
  .description("Remove a namespace profile")
  .action(async (name: string) => {
    const config = await loadConfig();
    const idx = config.profiles.findIndex((p) => p.name === name);

    if (idx < 0) {
      console.error(chalk.red(`Profile "${name}" not found`));
      process.exit(1);
    }

    config.profiles.splice(idx, 1);

    if (config.activeProfile === name) {
      config.activeProfile = config.profiles[0]?.name;
    }

    await saveConfig(config);
    console.log(chalk.green(`Removed profile "${name}"`));
  });
