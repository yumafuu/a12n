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

## Commands

aiorchestration provides several subcommands to manage your agent sessions:

### `aio` or `aio start`
Start a new orchestration session. Creates a new tmux window with planner and orchestrator agents.

```bash
aio          # Start new session
aio start    # Same as above
```

### `aio stop [uid]`
Stop one or all orchestration sessions.

```bash
aio stop           # Stop all sessions
aio stop wm3gbt    # Stop specific session by UID
```

### `aio status`
Show all active orchestration sessions and their status.

```bash
aio status
```

Example output:
```
Active aiorchestration sessions:
  - Session: wm3gbt
    Window: @12
    Panes: Orche, Worker-abc123

Database: /path/to/.aio/aiorchestration.db (exists)
```

### `aio clean`
Clean up data files (.aio directory). Requires all sessions to be stopped first.

```bash
aio stop    # Stop all sessions first
aio clean   # Then clean data
```

### `aio help`
Show help message with all available commands.

```bash
aio help
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
