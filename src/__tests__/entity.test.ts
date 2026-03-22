import { describe, it, expect } from "vitest";
import { parseEntity } from "../lib/entity.js";

describe("parseEntity", () => {
  it("parses a queue name", () => {
    expect(parseEntity("my-queue")).toEqual({ queue: "my-queue" });
  });

  it("parses a topic/subscription", () => {
    expect(parseEntity("my-topic/my-sub")).toEqual({
      topic: "my-topic",
      subscription: "my-sub",
    });
  });

  it("treats single segment as queue", () => {
    expect(parseEntity("orders")).toEqual({ queue: "orders" });
  });
});
