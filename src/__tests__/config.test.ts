import { describe, it, expect } from "vitest";
import { getActiveProfile, type CrucibleConfig } from "../lib/config.js";

describe("getActiveProfile", () => {
  const config: CrucibleConfig = {
    activeProfile: "prod",
    profiles: [
      { name: "dev", connectionString: "Endpoint=sb://dev..." },
      { name: "prod", namespace: "prod.servicebus.windows.net" },
    ],
  };

  it("returns the active profile", () => {
    expect(getActiveProfile(config)).toEqual(config.profiles[1]);
  });

  it("returns first profile when no active is set", () => {
    const noActive: CrucibleConfig = {
      profiles: [{ name: "dev", connectionString: "Endpoint=sb://dev..." }],
    };
    expect(getActiveProfile(noActive)).toEqual(noActive.profiles[0]);
  });

  it("returns undefined when no profiles exist", () => {
    expect(getActiveProfile({ profiles: [] })).toBeUndefined();
  });
});
