# AI Orchestration MCP (a12n)

MCP implementation that runs Claude CLI as autonomous agents. Orchestrator and workers collaborate via tmux.

## Install

```bash
bun install -g github:yumafuu/aiorchestration
```

## Quick Start

```bash
tmux new -s a12n
aio
```

## How It Works

```
You: "Write tests"
  ↓
Orchestrator spawns worker in new tmux pane
  ↓
Worker executes task
  ↓
Worker requests review → Orchestrator reviews → Done
```

## Architecture

```
Human
  ↓
Claude CLI (orchestrator)
  └── MCP Server
        ├── Watcher (monitors SQLite)
        ├── tmux pane management
        └── SQLite messaging
              ↓
        Claude CLI (worker)
```

## MCP Tools

**Orchestrator**: `spawn_worker`, `kill_worker`, `list_workers`, `send_message`, `check_messages`, `complete_task`, `get_task_status`

**Worker**: `check_messages`, `send_message`, `update_progress`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Project root directory | `process.cwd()` |
| `DB_PATH` | SQLite database path | `aiorchestration.db` |

See [specification.md](./specification.md) for details.
