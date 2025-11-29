# AI Orchestration MCP - 仕様書

## 概要

Claude CLI を自律型エージェントとして動作させるための MCP (Model Context Protocol) 実装。
tmux を UI として使用し、planner / orchestrator (orche) / worker の 3 つのロールで協調動作する。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  Human                                                          │
│    │                                                            │
│    ▼                                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Claude CLI (planner role)                              │   │
│  │    └── MCP Server (planner tools)                       │   │
│  │          ├── 要件明確化                                  │   │
│  │          ├── タスク定義 → orche に送信                   │   │
│  │          ├── PR レビュー (worker の成果物)               │   │
│  │          └── 人間への報告                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                                     │
│           │ SQLite (messages)                                   │
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Claude CLI (orche role)                                │   │
│  │    └── MCP Server (orche tools)                         │   │
│  │          ├── git worktree 作成                           │   │
│  │          ├── tmux pane 作成 + worker 起動                │   │
│  │          ├── SQLite: タスク発行 / heartbeat 監視         │   │
│  │          ├── メッセージ転送 (planner ↔ worker)          │   │
│  │          └── タスク完了時 worktree 削除                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                                     │
│           │ SQLite + git worktree                               │
│           ▼                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Claude CLI  │  │ Claude CLI  │  │ Claude CLI  │             │
│  │ (worker)    │  │ (worker)    │  │ (worker)    │             │
│  │ worktree-1  │  │ worktree-2  │  │ worktree-3  │             │
│  │  └── MCP    │  │  └── MCP    │  │  └── MCP    │             │
│  │   (worker   │  │   (worker   │  │   (worker   │             │
│  │    tools)   │  │    tools)   │  │    tools)   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│    tmux pane 1     tmux pane 2     tmux pane 3                 │
│    branch: task/a  branch: task/b  branch: task/c              │
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
| 並列作業 | git worktree |
| 成果物管理 | GitHub PR |

## 通信方式

- **Polling (プル型)**: 各ロールが `check_messages` を定期的に呼び出してメッセージを取得
- **Watcher**: SQLite を監視し、新規メッセージを tmux send-keys で通知
- **Heartbeat**: `check_messages` 呼び出し時に自動更新 (30秒タイムアウト)
- **メッセージ永続化**: SQLite による順序保証・永続化

## ロール

### Planner

- 人間からの指示を受け取る
- 曖昧な指示を具体的な要件に明確化
- タスクを定義して orche に送信
- worker の PR をレビュー
- 完了を人間に報告

### Orchestrator (orche)

- planner からタスクを受け取る
- **git worktree を作成**して独立した作業環境を用意
- tmux pane を作成し worker を起動
- worker にタスクを割り当て
- worker と planner 間のメッセージを転送
- タスク完了時に worktree を削除
- タスクの状態を管理

### Worker

- orche からタスクを受け取る
- **専用の worktree** 内でタスクを実行
- 進捗を報告
- **PR を作成**して成果物を提出
- レビュー依頼を送信 (orche 経由で planner へ)
- `TASK_COMPLETE` 受信で終了

## 並列タスク実行

複数の worker が同じリポジトリで並列して作業するため、git worktree を使用します。

### worktree の構成

```
TARGET_REPO_ROOT/
├── .git/                    # メインリポジトリ
├── .worktrees/              # worktree 保存ディレクトリ
│   ├── worker-abc123/       # worker-1 の作業ディレクトリ
│   │   └── (branch: task/xxx)
│   └── worker-def456/       # worker-2 の作業ディレクトリ
│       └── (branch: task/yyy)
└── src/                     # メインブランチのソース
```

### worktree のライフサイクル

1. `spawn_worker` 時に worktree を作成
2. 新しいブランチ `task/{task_id}` を作成
3. worker がその worktree 内で作業
4. worker が PR を作成
5. `complete_task` 時に worktree を削除

## MCP ツール

### Planner 用ツール

| ツール名 | 説明 | 引数 |
|----------|------|------|
| `send_task_to_orche` | タスクを orche に送信 | `description`, `context?` |
| `check_messages` | orche からのメッセージ取得 | `last_id?` |
| `send_review_result` | レビュー結果を orche に送信 | `task_id`, `approved`, `feedback?` |
| `list_tasks` | 全タスクの一覧を取得 | - |

### Orche 用ツール

| ツール名 | 説明 | 引数 |
|----------|------|------|
| `spawn_worker` | worktree 作成 + tmux pane 作成 + worker 起動 | `task_id?`, `description`, `context?` |
| `kill_worker` | worker を強制終了 (worktree も削除) | `worker_id` |
| `list_workers` | 稼働中 worker 一覧 | - |
| `send_message` | worker にメッセージ送信 | `worker_id`, `type`, `payload` |
| `check_messages` | worker/planner からのメッセージ取得 | `last_id?` |
| `complete_task` | worker にタスク完了を通知 (worktree 削除) | `task_id` |
| `get_task_status` | タスクの状態を確認 | `task_id` |

### Worker 用ツール

| ツール名 | 説明 | 引数 |
|----------|------|------|
| `check_messages` | orche からのメッセージ取得 (+ heartbeat 自動更新) | `last_id?` |
| `send_message` | orche にメッセージ送信 | `type`, `payload` |
| `update_progress` | 進捗更新 (Dashboard 表示用) | `status`, `message` |
| `create_pr` | GitHub PR を作成 | `title`, `body` |

## メッセージスキーマ

### 共通フィールド

```typescript
type Message = {
  id: string          // UUID
  timestamp: number   // Unix ms
  from: string        // "planner" | "orche" | worker_id
  to: string          // "planner" | "orche" | worker_id
  type: MessageType
  payload: unknown
}
```

### メッセージタイプ

| type | 方向 | payload |
|------|------|---------|
| `TASK_ASSIGN` | planner → orche → worker | `{ task_id?, description, context?, worktree_path?, branch_name? }` |
| `PROGRESS` | worker → orche | `{ task_id, status, message }` |
| `QUESTION` | worker → orche | `{ task_id, question }` |
| `ANSWER` | orche → worker | `{ task_id, answer }` |
| `REVIEW_REQUEST` | worker → orche → planner | `{ task_id, summary, files?, pr_url? }` |
| `REVIEW_RESULT` | planner → orche → worker | `{ task_id, approved, feedback? }` |
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
  worktree_path TEXT,          -- worktree のパス
  branch_name TEXT,            -- ブランチ名
  pr_url TEXT,                 -- GitHub PR の URL
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
| `review` | planner レビュー待ち (PR 作成済み) | worker が `REVIEW_REQUEST` 送信時 |
| `completed` | 完了 | orche が `complete_task` 実行時 |
| `failed` | 失敗 | heartbeat タイムアウト or 明示的失敗 |

**review → in_progress**: planner がフィードバック (approved: false) 送信時に自動遷移

## 起動方法

### 簡単な起動

```bash
bun run start
```

これで tmux セッション `aio-{uid}` が作成され、planner (左) と orche (右) が起動します。
セッション名はユニークな ID が付与されるため、複数のセッションを同時に起動できます。

### 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|------------|
| `PROJECT_ROOT` | aiorchestration プロジェクトのルート | `process.cwd()` |
| `TARGET_REPO_ROOT` | worker が作業する対象リポジトリのルート | `process.cwd()` |
| `DB_PATH` | SQLite データベースのパス | `aiorchestration.db` |

### 手動起動

各ロールを個別に起動する場合:

```bash
# Planner
claude --mcp-config planner.json --system-prompt "$(cat planner-prompt.md)"

# Orche
claude --mcp-config orche.json --system-prompt "$(cat orche-prompt.md)"

# Worker (orche が自動起動)
claude --mcp-config worker.json --system-prompt "$(cat worker-prompt.md)"
```

## 通信フロー例

```
[要件明確化]
Human → planner: 「テスト書いて」
planner → Human: 「どのファイルのテストですか？」
Human → planner: 「src/lib/db.ts のテスト」

[タスク送信]
planner → SQLite: orche 宛 TASK_ASSIGN メッセージ
watcher → orche: 「タスクが来ています」通知

[Worker 起動]
orche: git worktree add -b task/xxx .worktrees/worker-abc
orche → SQLite: task 作成 (worktree_path, branch_name 含む)
orche → tmux: worker pane 作成 & claude CLI 起動 (worktree 内で)

[作業中]
worker: polling でメッセージ取得
worker: worktree 内で作業実行
worker → SQLite: 進捗更新 + heartbeat

[PR 作成]
worker: git add && git commit
worker: create_pr を呼び出し → GitHub に PR 作成
worker → SQLite: REVIEW_REQUEST (pr_url 含む)

[レビュー依頼転送]
orche: check_messages で REVIEW_REQUEST 検知
orche → SQLite: task.pr_url を保存
orche → SQLite: planner 宛 REVIEW_REQUEST メッセージ (自動転送)
watcher → planner: 「レビュー依頼が来ています」通知

[レビュー]
planner: PR を確認してレビュー実施
planner → SQLite: orche 宛 REVIEW_RESULT メッセージ
watcher → orche: 「レビュー結果が来ています」通知

[結果転送]
orche → SQLite: worker 宛 REVIEW_RESULT メッセージ

[修正 (必要な場合)]
worker: polling でメッセージ取得
worker: worktree 内で修正実施
worker: git commit --amend または新しいコミット
worker: git push -f
worker → SQLite: 「修正しました」

[完了]
orche → SQLite: TASK_COMPLETE メッセージ
worker: polling で完了を検知 → プロセス終了
orche: git worktree remove .worktrees/worker-abc
orche → tmux: worker pane を kill
```

## Watcher

watcher は SQLite を監視し、新しいメッセージが来たら対象の pane に通知を送ります。

- orche の起動時に自動で開始 (mcp-server.ts から spawn)
- planner (pane 0) と orche (pane 1) の両方を監視
- 2秒ごとにポーリング
- 新しいメッセージを検知したら tmux send-keys で通知

## 障害復旧

| 障害 | 対応 |
|------|------|
| worker クラッシュ | heartbeat タイムアウト (30秒) で検知、orche が判断、worktree は残る |
| orche クラッシュ | planner または人間が手動リカバー、worktree は手動削除 |
| planner クラッシュ | 人間が手動リカバー |
| SQLite エラー | ファイルロックなど、再試行して失敗時は処理停止 |

### worktree の手動クリーンアップ

```bash
# 残っている worktree を確認
git worktree list

# 不要な worktree を削除
git worktree remove --force .worktrees/worker-xxx
```

## MCP 設定ファイル

### planner.json

```json
{
  "mcpServers": {
    "aiorchestration": {
      "command": "bun",
      "args": ["run", "/path/to/mcp-server.ts", "--role", "planner"],
      "env": {
        "PROJECT_ROOT": "/path/to/aiorchestration"
      }
    }
  }
}
```

### orche.json

```json
{
  "mcpServers": {
    "aiorchestration": {
      "command": "bun",
      "args": ["run", "/path/to/mcp-server.ts", "--role", "orche"],
      "env": {
        "PROJECT_ROOT": "/path/to/aiorchestration",
        "TARGET_REPO_ROOT": "/path/to/target-repo"
      }
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
      "args": ["run", "/path/to/mcp-server.ts", "--role", "worker"],
      "env": {
        "PROJECT_ROOT": "/path/to/aiorchestration"
      }
    }
  }
}
```

## 各ロールの禁止事項

### Planner

- 曖昧な指示をそのまま orche に送る
- 自分でコードを書く
- worker の作業に直接介入する

### Orchestrator

- コードを書く
- ファイルを作成・編集する
- 直接実装する
- レビューを自分で行う (planner の役割)

### Worker

- `check_messages` を呼ばずに長時間作業しない
- orche の指示なしにタスクを完了扱いにしない
- PR を作成せずに REVIEW_REQUEST を送らない
- 他のブランチに切り替える (worktree のブランチを使う)

## 前提条件

- `gh` CLI がインストールされ、認証済みであること
- 対象リポジトリが GitHub 上にあること
- git worktree が使用可能であること

## 今後の拡張 (POC 後)

- [ ] Dashboard (Web UI / TUI) によるタスク進捗可視化
- [ ] tmux 割り込みによる緊急通知
- [ ] 複数タスクの並列管理 ← **git worktree で実現済み**
- [ ] worker 間の直接通信
- [ ] planner による複数タスクの計画立案
- [ ] PR の自動マージ機能
