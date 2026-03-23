# Crucible CLI

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=broediger_crucible-cli&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=broediger_crucible-cli)
[![CI](https://github.com/broediger/crucible-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/broediger/crucible-cli/actions)
[![npm version](https://img.shields.io/npm/v/crucible-cli)](https://www.npmjs.com/package/crucible-cli)
[![npm downloads](https://img.shields.io/npm/dm/crucible-cli)](https://www.npmjs.com/package/crucible-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/broediger/crucible-cli/pulls)

The `kubectl` of Azure Service Bus — CLI for message operations, DLQ management, and namespace monitoring.

## Install

```bash
npm install -g crucible-cli
```

## Quick Start

```bash
# Add a namespace (connection string)
crucible config add dev --connection-string "Endpoint=sb://..."

# Or use Entra ID (DefaultAzureCredential)
crucible config add prod --namespace "my-ns.servicebus.windows.net"

# Interactive browser login
crucible login --tenant <tenant-id>

# Health overview
crucible status
crucible status --watch          # auto-refresh every 5s
crucible status --sort dlq       # surface problems first
crucible status --dlq            # only entities with dead-letters
crucible status --dlq-subs       # topics with DLQ subs (shows all sibling subs)
crucible status --dlq-topics     # one row per topic with DLQ (aggregated)
crucible status --filter "*dev*" # glob filter on entity name

# Live TUI dashboard
crucible monitor                 # htop-style, press q to quit
crucible monitor --entity orders # filter to matching entities
crucible monitor --interval 10   # poll every 10s

# Browse messages
crucible peek my-queue
crucible peek my-topic/my-sub --dlq --count 50
crucible inspect my-queue --seq 12345

# Search
crucible search my-queue --body "OrderId:123"
crucible search my-queue --property "CorrelationId=abc"

# Dead-letter management
crucible deadletter my-queue --reasons
crucible replay my-queue --dry-run
crucible replay my-queue --count 10 --backup before-replay.json
crucible purge my-queue --dlq

# Send messages
crucible send my-queue --body '{"orderId": 123}'
crucible send my-queue --file payload.json --count 100 --delay 50

# Export / Import
crucible export my-queue --dlq --format json > dlq-messages.json
crucible export my-queue --format csv > messages.csv
crucible import my-queue --file dlq-messages.json

# Namespace topology
crucible topology                # tree view
crucible topology --format mermaid > topology.md

# Snapshot & drift detection
crucible snapshot -o baseline.json
crucible diff baseline.json      # compare live vs snapshot
crucible diff ns-dev.servicebus.windows.net ns-prod.servicebus.windows.net

# Cost analysis
crucible costs
crucible costs --optimize        # surface unused queues, DLQ issues

# Local DLQ alerting
crucible watch my-queue --dlq-threshold 10 --notify
crucible watch my-queue --dlq-threshold 100 --exec 'curl -X POST https://hooks.slack.com/... -d "{\"text\":\"DLQ alert: $CRUCIBLE_ENTITY has $CRUCIBLE_DLQ messages\"}"'
```

## Commands

### Foundation
| Command | Description |
|---|---|
| `crucible config add/list/use/remove` | Manage namespace profiles |
| `crucible login` | Interactive browser login (Entra ID) |

### Core Operations
| Command | Description |
|---|---|
| `crucible status` | Health overview — `--filter`, `--dlq`, `--dlq-subs`, `--dlq-topics`, `--watch`, `--sort`, `--json` |
| `crucible peek` | Peek messages — `--dlq`, `--count`, `--format json\|table` |
| `crucible inspect` | Inspect single message by `--seq` sequence number |
| `crucible search` | Search by `--body` text or `--property` key=value |
| `crucible deadletter` | List DLQ messages, `--reasons` to aggregate by dead-letter reason |
| `crucible replay` | Replay DLQ messages — `--count`, `--filter`, `--dry-run`, `--to`, `--backup` |
| `crucible purge` | Purge messages with confirmation — `--dlq`, `--yes`, `--backup` |
| `crucible send` | Send messages — `--body`, `--file`, `--property`, `--count`, `--schedule` |

### Monitoring & Advanced
| Command | Description |
|---|---|
| `crucible monitor` | Live TUI dashboard (ink) — real-time counts, DLQ trends, `--entity`, `--interval` |
| `crucible watch` | Local DLQ alerts — `--dlq-threshold`, `--exec`, `--notify` |
| `crucible export` | Export messages as JSON or CSV (pipe-friendly) |
| `crucible import` | Bulk send from JSON file |
| `crucible topology` | Namespace tree — `--format tree\|json\|mermaid` |

### Power Features
| Command | Description |
|---|---|
| `crucible snapshot` | Save namespace state (entities, configs, rules) to JSON |
| `crucible diff` | Compare snapshot vs live, or two namespaces (exit code 2 on drift) |
| `crucible costs` | Estimated monthly cost breakdown, `--optimize` for suggestions |

## Authentication

Crucible supports three auth methods:

| Method | Usage |
|---|---|
| **Connection string** | `crucible config add dev --connection-string "Endpoint=sb://..."` |
| **Entra ID (automatic)** | `crucible config add prod --namespace "ns.servicebus.windows.net"` — uses `DefaultAzureCredential` (picks up `az login`, env vars, managed identity) |
| **Entra ID (interactive)** | `crucible login --tenant <tenant-id>` — opens browser for login |

All commands support `--namespace <fqdn>` to override the active profile.

## Scripting

- `--json` on status, deadletter, inspect, export, costs, diff, peek, search
- `--yes` on purge (skip confirmation)
- `--backup <file>` on replay and purge (save messages before destructive ops)
- Exit codes: `0` success, `1` error, `2` warning/drift detected

```bash
# CI example: fail if namespace has drifted from baseline
crucible diff baseline.json || echo "Drift detected!"

# Export DLQ messages as JSON for scripting
crucible export my-queue --dlq --format json | jq '.[].body'
```

## License

MIT
