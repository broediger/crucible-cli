import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface NamespaceProfile {
  name: string;
  namespace?: string;
  connectionString?: string;
}

export interface CrucibleConfig {
  activeProfile?: string;
  profiles: NamespaceProfile[];
}

const CONFIG_DIR = join(homedir(), ".crucible");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<CrucibleConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CrucibleConfig;
  } catch {
    return { profiles: [] };
  }
}

export async function saveConfig(config: CrucibleConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function getActiveProfile(
  config: CrucibleConfig
): NamespaceProfile | undefined {
  if (!config.activeProfile) return config.profiles[0];
  return config.profiles.find((p) => p.name === config.activeProfile);
}
