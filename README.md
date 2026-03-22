# Crucible CLI

The `kubectl` of Azure Service Bus — CLI for message operations, DLQ management, and namespace monitoring.

## Install

```bash
npm install -g crucible-cli
```

## Quick Start

```bash
# Add a namespace
crucible config add dev --connection-string "Endpoint=sb://..."

# Or use Entra ID
crucible config add prod --namespace "my-ns.servicebus.windows.net"

# Check health
crucible status

# Peek messages
crucible peek my-queue
crucible peek my-topic/my-subscription --dlq

# Inspect dead-letter queue
crucible deadletter my-queue --reasons

# Replay dead-letters
crucible replay my-queue --dry-run
crucible replay my-queue --count 10

# Send a message
crucible send my-queue --body '{"orderId": 123}'
```

## Commands

| Command | Description |
|---|---|
| `crucible config` | Manage namespace profiles (add, list, use, remove) |
| `crucible status` | Health overview — queues, topics, DLQ counts |
| `crucible peek` | Peek messages from queues or subscriptions |
| `crucible deadletter` | List DLQ messages, aggregate by reason |
| `crucible replay` | Replay dead-letters back to source (with filters, dry-run) |
| `crucible send` | Send messages (from JSON, file, with scheduling) |

## Authentication

Crucible supports two auth methods:

- **Connection string** — simplest, pass via `--connection-string`
- **Entra ID** — uses `DefaultAzureCredential` (picks up `az login`, env vars, managed identity)

## License

MIT
