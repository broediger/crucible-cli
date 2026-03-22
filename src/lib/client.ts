import {
  ServiceBusClient,
  ServiceBusAdministrationClient,
} from "@azure/service-bus";
import { DefaultAzureCredential } from "@azure/identity";
import { loadConfig, getActiveProfile } from "./config.js";

export interface Clients {
  client: ServiceBusClient;
  admin: ServiceBusAdministrationClient;
}

export async function createClients(
  namespaceOverride?: string
): Promise<Clients> {
  const config = await loadConfig();
  const profile = getActiveProfile(config);

  if (namespaceOverride) {
    const credential = new DefaultAzureCredential();
    return {
      client: new ServiceBusClient(namespaceOverride, credential),
      admin: new ServiceBusAdministrationClient(namespaceOverride, credential),
    };
  }

  if (!profile) {
    throw new Error(
      "No namespace configured. Run: crucible config add <name> --connection-string <string>"
    );
  }

  if (profile.connectionString) {
    return {
      client: new ServiceBusClient(profile.connectionString),
      admin: new ServiceBusAdministrationClient(profile.connectionString),
    };
  }

  if (profile.namespace) {
    const credential = new DefaultAzureCredential();
    return {
      client: new ServiceBusClient(profile.namespace, credential),
      admin: new ServiceBusAdministrationClient(profile.namespace, credential),
    };
  }

  throw new Error(
    `Profile "${profile.name}" has no connection string or namespace configured.`
  );
}
