# AI Orchestration MCP - 仕様書

## 概要

Claude CLI を自律型エージェントとして動作させるための MCP (Model Context Protocol) 実装。
tmux を UI として使用し、orchestrator (orche) と worker の 2 つのロールで協調動作する。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  Human                                                          │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Claude CLI (orche role)                                │   │
│  │    └── MCP Server (orche tools)                         │   │
│  │          ├── tmux pane 作成                              │   │
│  │          ├── worker 起動                                 │   │
│  │          ├── SQLite: タスク発行 / heartbeat 監視         │   │
│  │          └── タスク状態管理                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                                     │
│           │ SQLite                                               │
│           ▼                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Claude CLI  │  │ Claude CLI  │  │ Claude CLI  │             │
│  │ (worker)    │  │ (worker)    │  │ (worker)    │             │
│  │  └── MCP    │  │  └── MCP    │  │  └── MCP    │             │
│  │   (worker   │  │   (worker   │  │   (worker   │             │
│  │    tools)   │  │    tools)   │  │    tools)   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│    tmux pane 1     tmux pane 2     tmux pane 3                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 技術スタック

| 項目 | 技術 |
|------|------|
| 実装言語 | Bun (TypeScript) |
| UI | tmux |
| データベース | SQLite (bun:sqlite) |
| Claude 起動 | Claude CLI |

## 通信方式

- **Polling (プル型)**: worker が `check_messages` を定期的に呼び出してメッセージを取得
- **Heartbeat**: `check_messages` 呼び出し時に自動更新 (30秒タイムアウト)
- **メッセージ永続化**: SQLite による順序保証・永続化

## ロール

### Orchestrator (orche)

- 人間からの指示を受け取る
- タスクを作成し、worker に割り当てる
- worker の成果物をレビュー
- タスクの完了を判断

### Worker

- orche からタスクを受け取る
- タスクを実行
- 進捗を報告
- レビュー依頼を送信
- `TASK_COMPLETE` 受信で終了

## MCP ツール

### Orche 用ツール

| ツール名 | 説明 | 引数 |
|----------|------|------|
| `spawn_worker` | tmux pane 作成 + worker 起動 + タスク割り当て | `task_id`, `description`, `context?` |
| `kill_worker` | worker を強制終了 | `worker_id` |
| `list_workers` | 稼働中 worker 一覧 | - |
| `send_message` | worker にメッセージ送信 | `worker_id`, `type`, `payload` |
| `check_messages` | worker からのメッセージ取得 | - |
| `complete_task` | worker にタスク完了を通知 | `task_id` |

### Worker 用ツール

| ツール名 | 説明 | 引数 |
|----------|------|------|
| `check_messages` | orche からのメッセージ取得 (+ heartbeat 自動更新) | - |
| `send_message` | orche にメッセージ送信 | `type`, `payload` |
| `update_progress` | 進捗更新 (Dashboard 表示用) | `status`, `message` |

## メッセージスキーマ

### 共通フィールド

```typescript
type Message = {
  id: string          // UUID
  timestamp: number   // Unix ms
  from: string        // "orche" | worker_id
  to: string          // "orche" | worker_id
  type: MessageType
  payload: unknown
}
```

### メッセージタイプ

| type | 方向 | payload |
|------|------|---------|
| `TASK_ASSIGN` | orche → worker | `{ task_id, description, context }` |
| `PROGRESS` | worker → orche | `{ task_id, status, message }` |
| `QUESTION` | worker → orche | `{ task_id, question }` |
| `ANSWER` | orche → worker | `{ task_id, answer }` |
| `REVIEW_REQUEST` | worker → orche | `{ task_id, summary, files }` |
| `REVIEW_RESULT` | orche → worker | `{ task_id, approved, feedback }` |
| `TASK_COMPLETE` | orche → worker | `{ task_id }` |

## SQLite データ構造

### テーブル

```sql
-- メッセージテーブル
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  seq INTEGER UNIQUE,          -- 順序保証用の連番
  timestamp INTEGER NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL        -- JSON
);

-- タスクテーブル
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  worker_id TEXT,
  description TEXT NOT NULL,
  context TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ワーカーテーブル
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  task_id TEXT,
  pane_id TEXT,
  last_heartbeat INTEGER NOT NULL  -- 30秒以内なら生存
);
```

### データベースファイル

デフォルト: `aiorchestration.db` (環境変数 `DB_PATH` で変更可能)

## タスク状態遷移

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
┌─────────┐    ┌─────────────┐    ┌──────────┐   │
│ pending │───▶│ in_progress │───▶│  review  │───┘
└─────────┘    └─────────────┘    └──────────┘
     │               │                  │
     │               │                  │
     │               ▼                  ▼
     │          ┌─────────┐       ┌───────────┐
     └─────────▶│ failed  │       │ completed │
                └─────────┘       └───────────┘
```

| 状態 | 説明 | 遷移条件 |
|------|------|----------|
| `pending` | タスク作成済み、worker 未起動 | 初期状態 |
| `in_progress` | worker 作業中 | `spawn_worker` 実行時 |
| `review` | orche レビュー待ち | worker が `REVIEW_REQUEST` 送信時 |
| `completed` | 完了 | orche が `complete_task` 実行時 |
| `failed` | 失敗 | heartbeat タイムアウト or 明示的失敗 |

**review → in_progress**: orche がフィードバック送信時に自動遷移

## Worker 起動

### コマンド

```bash
claude --mcp-config worker.json --system-prompt "$(cat worker-prompt.md)" \
  --task-id "t1" --task-desc "テストを書いて"
```

### Worker システムプロンプト

```markdown
# あなたは Worker エージェントです

## 必須ルール

1. **最初に必ず `check_messages` を呼ぶ**
2. タスクを受け取ったら作業を開始
3. **5 アクション毎に `check_messages` を呼ぶ**
4. 質問があれば `send_message` で orche に聞く
5. 作業完了したら `send_message` で `REVIEW_REQUEST` を送る
6. `TASK_COMPLETE` を受け取ったら作業終了

## 進捗報告

作業の節目で `update_progress` を呼んで状況を報告してください。

## 禁止事項

- `check_messages` を呼ばずに長時間作業しない
- orche の指示なしにタスクを完了扱いにしない
```

## 通信フロー例

```
[タスク開始]
Human → orche: 「テスト書いて」
orche → SQLite: task 作成 + worker 宛メッセージ
orche → tmux: worker pane 作成 & claude CLI 起動

[作業中]
worker: polling でメッセージ取得
worker: 作業実行
worker → SQLite: 進捗更新 + heartbeat
worker → SQLite: 「完了しました、レビューお願いします」

[レビュー]
orche: polling でメッセージ取得
orche: レビュー実施
orche → SQLite: 「修正してください」

[修正]
worker: polling でメッセージ取得
worker: 修正実施
worker → SQLite: 「修正しました」

[完了]
orche → SQLite: 「完了」メッセージ
worker: polling で「完了」を検知 → プロセス終了
```

## 障害復旧

| 障害 | 対応 |
|------|------|
| worker クラッシュ | heartbeat タイムアウト (30秒) で検知、orche が判断 |
| orche クラッシュ | 人間が手動リカバー |
| SQLite エラー | ファイルロックなど、再試行して失敗時は処理停止 |

## MCP 設定ファイル

### orche.json

```json
{
  "mcpServers": {
    "aiorchestration": {
      "command": "bun",
      "args": ["run", "/path/to/mcp-server.ts", "--role", "orche"]
    }
  }
}
```

### worker.json

```json
{
  "mcpServers": {
    "aiorchestration": {
      "command": "bun",
      "args": ["run", "/path/to/mcp-server.ts", "--role", "worker", "--worker-id", "${WORKER_ID}"]
    }
  }
}
```

## 今後の拡張 (POC 後)

- [ ] Dashboard (Web UI / TUI) によるタスク進捗可視化
- [ ] tmux 割り込みによる緊急通知
- [ ] 複数タスクの並列管理
- [ ] worker 間の直接通信
