# AI Orchestration MCP (a12n)

Claude CLI を自律型エージェントとして動作させる MCP 実装。
tmux 上で orchestrator (orche) と worker が協調してタスクを実行する。

## セットアップ

```bash
bun install
```

## 起動方法

### 1. tmux セッションを開始

```bash
tmux new -s a12n
```

### 2. Orchestrator として Claude を起動

```bash
claude --mcp-config /path/to/a12n/orche.json
```

### 使い方

Claude に指示を出すと、orche が worker を spawn してタスクを実行する。

```
あなた: テストを書いて

Claude (orche): spawn_worker ツールで worker を起動します...
→ tmux の新しい pane に worker Claude が起動
→ worker がタスクを実行
→ worker がレビュー依頼を送信
→ orche がレビューして完了通知
```

## MCP ツール

### Orche 用

| ツール | 説明 |
|--------|------|
| `spawn_worker` | worker を起動してタスクを割り当て |
| `kill_worker` | worker を強制終了 |
| `list_workers` | 稼働中の worker 一覧 |
| `send_message` | worker にメッセージ送信 |
| `check_messages` | worker からのメッセージ取得 |
| `complete_task` | タスク完了を通知 |
| `get_task_status` | タスク状態を確認 |

### Worker 用

| ツール | 説明 |
|--------|------|
| `check_messages` | orche からのメッセージ取得 |
| `send_message` | orche にメッセージ送信 |
| `update_progress` | 進捗を更新 |

## 設定ファイル

### orche.json

Orchestrator 用の MCP 設定。パスは環境に合わせて変更。

```json
{
  "mcpServers": {
    "aiorchestration": {
      "command": "bun",
      "args": ["run", "/path/to/a12n/src/mcp-server.ts", "--role", "orche"],
      "env": {
        "PROJECT_ROOT": "/path/to/a12n"
      }
    }
  }
}
```

### worker.json

Worker 用の MCP 設定。orche が worker を spawn する際に使用。

## 環境変数

| 変数 | 説明 | デフォルト |
|------|------|------------|
| `PROJECT_ROOT` | プロジェクトルート | `process.cwd()` |
| `DB_PATH` | SQLite データベースパス | `aiorchestration.db` |
| `WORKER_ID` | Worker の ID (自動設定) | - |
| `TASK_ID` | タスク ID (自動設定) | - |

## アーキテクチャ

```
Human
  │
  ▼
Claude CLI (orche)
  └── MCP Server (orche tools)
        ├── tmux pane 作成
        ├── worker 起動
        └── SQLite でメッセージング
              │
              ▼
        ┌─────────────┐
        │ Claude CLI  │  ← tmux pane
        │ (worker)    │
        │  └── MCP    │
        └─────────────┘
```

詳細は [specification.md](./specification.md) を参照。
