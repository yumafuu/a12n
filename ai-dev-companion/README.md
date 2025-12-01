# AI Development Companion

AI駆動開発伴奏支援システム - Cloudflare Workers + TypeScript で実装された、自動コードレビュー、Issue自動回答、Slack連携機能を提供するシステム

## 概要

このシステムは、クライアントのGitHubリポジトリでPR/Issueが作成された際に、自動でレビュー・回答を生成し、Slack経由でKOSコンサルタントが確認・修正・承認できる仕組みを提供します。

## 主な機能

### 1. 自動コードレビュー機能
- GitHub Webhook で `pull_request` イベント (opened, synchronize) を受信
- `X-Hub-Signature-256` でペイロード検証
- Octokit で PR の diff を取得
- Claude API に diff を送信してレビューコメントを生成
- レビュー結果を GitHub PR にコメントとして投稿

### 2. Issue質問の自動回答ドラフト生成機能
- GitHub Webhook で `issues` イベント (opened) を受信
- 対象リポジトリのコードを参照（Octokit で取得）
- KOSアセスメントシステム（仮データ）を参照
- Claude API で回答ドラフトを生成
- 生成された回答ドラフトを KOS Slack の指定チャンネルに投稿

### 3. 回答内容の修正機能
- Slack のスレッドへのコメントを検知
- コメント内容に基づいて Claude API で回答を更新
- 更新された回答を同スレッド内に投稿

### 4. 回答の承認・自動返信機能
- Slack 上で「承認」ボタンを実装
- 承認者の GitHub Name を特定（Slack ユーザーと GitHub ユーザーのマッピング）
- 承認者の名前で GitHub Issue にコメントを自動投稿

## 技術スタック

| 項目 | 選定 |
|------|------|
| ランタイム | Cloudflare Workers |
| 言語 | TypeScript |
| ローカル開発 | Bun + Wrangler |
| GitHub連携 | Octokit (GitHub API) |
| Slack連携 | @slack/web-api |
| AI | Claude API (Anthropic) |
| HTTP Framework | Hono |

## プロジェクト構成

```
ai-dev-companion/
├── src/
│   ├── index.ts                    # メインエントリーポイント
│   ├── types.ts                    # 型定義
│   ├── handlers/
│   │   ├── github-webhook.ts       # GitHub Webhook ハンドラー
│   │   └── slack-webhook.ts        # Slack Webhook ハンドラー
│   ├── services/
│   │   ├── claude.ts               # Claude API サービス
│   │   ├── github.ts               # GitHub サービス
│   │   └── slack.ts                # Slack サービス
│   ├── utils/
│   │   ├── github.ts               # GitHub ユーティリティ
│   │   └── slack.ts                # Slack ユーティリティ
│   └── data/
│       ├── kos-assessment-mock.ts  # KOS アセスメント仮データ
│       └── user-mapping-mock.ts    # Slack-GitHub ユーザーマッピング
├── package.json
├── tsconfig.json
├── wrangler.toml
└── README.md
```

## セットアップ

### 1. 依存関係のインストール

```bash
bun install
```

### 2. 環境変数の設定

以下の secrets を Wrangler で設定する必要があります:

```bash
# GitHub Webhook Secret
wrangler secret put GITHUB_WEBHOOK_SECRET

# GitHub Personal Access Token (repo, write:discussion 権限が必要)
wrangler secret put GITHUB_TOKEN

# Anthropic API Key
wrangler secret put ANTHROPIC_API_KEY

# Slack Bot Token (xoxb- で始まるトークン)
wrangler secret put SLACK_BOT_TOKEN

# Slack Signing Secret
wrangler secret put SLACK_SIGNING_SECRET

# (Optional) Slack Channel ID
wrangler secret put SLACK_CHANNEL_ID
```

### 3. ローカル開発

```bash
bun run dev
```

ローカルサーバーが起動します（通常は `http://localhost:8787`）。

### 4. デプロイ

```bash
bun run deploy
```

デプロイ後、Cloudflare Workers の URL が表示されます（例: `https://ai-dev-companion.your-subdomain.workers.dev`）。

## Webhook 設定

### GitHub Webhook 設定

1. 対象リポジトリの Settings > Webhooks > Add webhook
2. Payload URL: `https://your-worker.workers.dev/webhook/github`
3. Content type: `application/json`
4. Secret: `GITHUB_WEBHOOK_SECRET` と同じ値
5. イベント選択:
   - `Pull requests`
   - `Issues`
6. Active にチェックを入れて保存

### Slack App 設定

#### 1. Slack App を作成

- [Slack API](https://api.slack.com/apps) にアクセス
- "Create New App" > "From scratch"
- App Name と Workspace を選択

#### 2. Bot Token Scopes を設定

Settings > OAuth & Permissions > Scopes で以下を追加:

- `chat:write`
- `chat:write.public`
- `reactions:write`

#### 3. Event Subscriptions を有効化

Settings > Event Subscriptions:

- Enable Events: ON
- Request URL: `https://your-worker.workers.dev/webhook/slack`
- Subscribe to bot events:
  - `message.channels` (チャンネルメッセージ)
  - `message.groups` (プライベートチャンネル)

#### 4. Interactive Components を有効化

Settings > Interactivity & Shortcuts:

- Interactivity: ON
- Request URL: `https://your-worker.workers.dev/webhook/slack`

#### 5. Install App

Settings > Install App から Workspace にインストールし、Bot User OAuth Token (`xoxb-...`) を取得して、`SLACK_BOT_TOKEN` として設定。

#### 6. Signing Secret を取得

Settings > Basic Information > App Credentials から Signing Secret を取得し、`SLACK_SIGNING_SECRET` として設定。

## ユーザーマッピング設定

`src/data/user-mapping-mock.ts` で Slack User ID と GitHub Username のマッピングを管理しています。

本番環境では、データベースまたは設定ファイルに移行することを推奨します。

```typescript
export const mockUserMapping: UserMapping[] = [
  {
    slack_user_id: 'U01234ABCDE',
    github_username: 'consultant1',
  },
  // ...
];
```

## KOS アセスメントデータ

`src/data/kos-assessment-mock.ts` で仮データを定義しています。

本番環境では、実際のKOSアセスメントシステムと連携するように変更してください。

## エンドポイント

- `GET /` - ヘルスチェック
- `POST /webhook/github` - GitHub Webhook 受信
- `POST /webhook/slack` - Slack イベント・インタラクション受信

## 受け入れ条件

- [x] PR 作成時に自動コードレビューが GitHub PR に投稿される
- [x] Issue 作成時に回答ドラフトが Slack に投稿される
- [x] Slack スレッドでのコメントで回答が更新される
- [x] Slack での承認で GitHub Issue に自動返信される

## システム構成図

```
[クライアント GitHub]
        ↓ PR作成 (Webhook)
[Cloudflare Workers] → レビュー生成 → GitHub PR にコメント

[クライアント GitHub]
        ↓ Issue作成 (Webhook)
[Cloudflare Workers] → 回答ドラフト生成 → Slack に投稿
        ↓
[KOSコンサルタント] Slack でスレッドコメント
        ↓
[Cloudflare Workers] → 回答更新 → Slack スレッドに投稿
        ↓
[KOSコンサルタント] Slack で承認
        ↓
[Cloudflare Workers] → GitHub Issue に自動返信
```

## トラブルシューティング

### Webhook が動作しない

- GitHub Webhook の設定で "Recent Deliveries" を確認
- Cloudflare Workers のログを確認: `wrangler tail`
- Signature 検証が失敗していないか確認

### Slack メッセージが投稿されない

- Bot Token が正しいか確認
- Bot がチャンネルに招待されているか確認
- Slack API の Scopes が正しく設定されているか確認

### Claude API エラー

- API Key が正しいか確認
- API の利用制限に達していないか確認

## 今後の改善

- [ ] KV Storage を使ってスレッドと Issue の紐付けを永続化
- [ ] Durable Objects を使ってステートフルな処理を実装
- [ ] テストコードの追加
- [ ] エラーハンドリングの強化
- [ ] ログ出力の改善
- [ ] KOS アセスメントシステムとの実際の連携

## ライセンス

MIT
