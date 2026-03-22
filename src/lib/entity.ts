/**
 * Parse an entity string into queue or topic/subscription parts.
 * Formats:
 *   "my-queue"           → { queue: "my-queue" }
 *   "my-topic/my-sub"    → { topic: "my-topic", subscription: "my-sub" }
 */
export function parseEntity(entity: string): {
  queue?: string;
  topic?: string;
  subscription?: string;
} {
  const parts = entity.split("/");
  if (parts.length === 2) {
    return { topic: parts[0], subscription: parts[1] };
  }
  return { queue: entity };
}
