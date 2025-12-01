# AI Orchestration MCP (a12n)

MCP implementation that runs Claude CLI as autonomous agents. Orchestrator and workers collaborate via tmux.

## Features

### Phase 1: Multi-Agent Orchestration
- Autonomous task execution with planner, orchestrator, and worker roles
- Git worktree-based parallel task execution
- tmux-based UI for monitoring multiple workers
- SQLite-based message passing and task management

### Phase 2: GitHub Issue Auto-Response & Slack Integration (NEW)
- Automatic draft responses for GitHub Issues using Claude AI
- Slack integration for review and approval workflow
- Context-aware responses using repository code and KOS assessment data
- Interactive Slack buttons for approve/edit/reject actions

## Install

```bash
bun install -g github:yumafuu/aiorchestration
```

## Quick Start

### AI Orchestration System

```bash
tmux new -s a12n
aio
```

### Issue Auto-Response Server

1. Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
# Edit .env with your tokens
```

2. Start the webhook server:

```bash
bun run src/server.ts
```

3. Configure GitHub webhook:
   - URL: `https://your-domain/webhook/github`
   - Events: Issues (opened)

4. Configure Slack app:
   - Interactive Components URL: `https://your-domain/webhook/slack`
   - Bot Token Scopes: `chat:write`, `chat:write.public`

## How It Works

### Multi-Agent Orchestration

```
You: "Write tests"
  ↓
Orchestrator spawns worker in new tmux pane
  ↓
Worker executes task
  ↓
Worker requests review → Orchestrator reviews → Done
```

### Issue Auto-Response Workflow

```
GitHub Issue Created
  ↓
Webhook receives event
  ↓
Fetch repository context (README, spec, etc.)
  ↓
Generate draft answer with Claude
  ↓
Post to Slack with approval buttons
  ↓
User approves → Post comment to GitHub
```

## Architecture

```
Human
  ↓
Claude CLI (planner)
  ↓
Claude CLI (orchestrator)
  └── MCP Server
        ├── Watcher (monitors SQLite)
        ├── tmux pane management
        └── SQLite messaging
              ↓
        Claude CLI (worker)

GitHub Webhook → Express Server → Claude API → Slack
```

## MCP Tools

**Planner**: `send_task_to_orche`, `check_messages`, `send_review_result`, `list_tasks`

**Orchestrator**: `spawn_worker`, `kill_worker`, `list_workers`, `send_message`, `check_messages`, `complete_task`, `get_task_status`

**Worker**: `check_messages`, `send_message`, `update_progress`, `create_pr`

## Environment Variables

### AI Orchestration

| Variable | Description | Default |
|----------|-------------|---------|
| `PROJECT_ROOT` | Project root directory | `process.cwd()` |
| `TARGET_REPO_ROOT` | Target repository root | `process.cwd()` |
| `DB_PATH` | SQLite database path | `aiorchestration.db` |

### Issue Auto-Response Server

| Variable | Description |
|----------|-------------|
| `PORT` | Server port |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Slack request verification secret |
| `SLACK_CHANNEL_ID` | Slack channel for posting drafts |
| `ANTHROPIC_API_KEY` | Claude API key |

See [specification.md](./specification.md) for details.
