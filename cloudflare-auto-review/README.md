# GitHub PR Auto Review - Cloudflare Workers

自動コードレビューシステム - GitHub Pull Request に自動でコードレビューを実行し、Claude AI によるフィードバックを投稿します。

## 概要

このプロジェクトは Cloudflare Workers 上で動作する GitHub PR 自動レビューサービスです。

### 主な機能

- 📩 **GitHub Webhook 受信**: PR の作成・更新イベントを受信
- 🔐 **署名検証**: HMAC SHA-256 による webhook ペイロードの検証
- 🤖 **AI レビュー**: Claude API によるコードレビュー生成
- 💬 **自動コメント**: レビュー結果を GitHub PR にコメント投稿
- 📊 **KOS アセスメント**: コード品質、セキュリティ、パフォーマンスなどを評価

## 技術スタック

| 項目 | 技術 |
|------|------|
| ランタイム | Cloudflare Workers |
| 言語 | TypeScript |
| ローカル開発 | Bun + Wrangler |
| GitHub 連携 | Octokit (GitHub REST API) |
| AI | Claude API (Anthropic) |

## セットアップ

### 1. 依存関係のインストール

```bash
bun install
```

### 2. 環境変数の設定

Cloudflare Workers では、以下のシークレットを設定する必要があります：

```bash
# GitHub Webhook Secret (任意の強力な文字列)
wrangler secret put GITHUB_WEBHOOK_SECRET

# GitHub Personal Access Token (repo スコープが必要)
wrangler secret put GITHUB_TOKEN

# Anthropic API Key
wrangler secret put ANTHROPIC_API_KEY
```

#### GitHub Token の取得方法

1. GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" をクリック
3. 以下のスコープを選択:
   - `repo` (Full control of private repositories)
4. トークンを生成してコピー

#### Anthropic API Key の取得方法

1. [Anthropic Console](https://console.anthropic.com/) にアクセス
2. API Keys セクションで新しいキーを作成
3. キーをコピー

### 3. ローカル開発

```bash
# 開発サーバーの起動
bun run dev
```

開発サーバーが `http://localhost:8787` で起動します。

#### ローカルでの環境変数設定

ローカル開発時は `.dev.vars` ファイルを作成します：

```bash
# .dev.vars (gitignore に含まれています)
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
GITHUB_TOKEN=ghp_your_github_token_here
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here
```

### 4. デプロイ

```bash
# Cloudflare Workers へデプロイ
bun run deploy
```

デプロイ後、Worker の URL が表示されます（例: `https://cloudflare-auto-review.your-subdomain.workers.dev`）

## GitHub Webhook の設定

1. 対象リポジトリの Settings → Webhooks → Add webhook
2. 以下を設定:
   - **Payload URL**: `https://your-worker-url.workers.dev/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: `wrangler secret put` で設定した `GITHUB_WEBHOOK_SECRET` と同じ値
   - **Events**: "Let me select individual events" を選択し、`Pull requests` のみチェック
3. "Add webhook" をクリック

## 使用方法

### 自動レビューの流れ

1. リポジトリに Pull Request を作成
2. GitHub が webhook を送信
3. Cloudflare Worker が webhook を受信・検証
4. PR の diff を取得
5. Claude API でレビューを生成
6. GitHub PR にコメントを自動投稿

### レビュー基準 (KOS Assessment)

自動レビューは以下の観点で評価を行います：

#### 1. コード品質
- 可読性
- 保守性
- 一貫性

#### 2. セキュリティ
- 入力検証
- 認証・認可
- データ保護
- 依存関係のセキュリティ

#### 3. パフォーマンス
- 効率性
- リソース使用量
- スケーラビリティ

#### 4. テスト
- テストカバレッジ
- エッジケース処理
- エラーハンドリング

#### 5. ドキュメント
- コードコメント
- API ドキュメント
- README 更新

#### 6. ベストプラクティス
- デザインパターン
- DRY 原則
- SOLID 原則

## アーキテクチャ

```
GitHub PR Event
      ↓
GitHub Webhook
      ↓
Cloudflare Worker (/webhook/github)
      ↓
Signature Verification (HMAC SHA-256)
      ↓
Fetch PR Diff (Octokit)
      ↓
Generate Review (Claude API)
      ↓
Post Comment (GitHub API)
```

## プロジェクト構成

```
cloudflare-auto-review/
├── src/
│   └── index.ts          # メインの Worker コード
├── wrangler.jsonc         # Wrangler 設定ファイル
├── package.json
├── tsconfig.json
├── .dev.vars             # ローカル環境変数 (gitignore)
└── README.md
```

## トラブルシューティング

### Webhook が受信されない

1. GitHub Webhook の設定を確認
   - Payload URL が正しいか
   - Secret が一致しているか
2. Cloudflare Workers のログを確認:
   ```bash
   wrangler tail
   ```

### レビューコメントが投稿されない

1. GitHub Token のスコープを確認（`repo` が必要）
2. Anthropic API Key が有効か確認
3. Worker のログでエラーを確認

### ローカル開発でシークレットが読み込めない

1. `.dev.vars` ファイルが存在するか確認
2. ファイル形式が正しいか確認（`KEY=value` 形式）

## コスト

### Cloudflare Workers
- **Free Tier**: 100,000 リクエスト/日まで無料
- **Paid Plan**: $5/月 + 超過分従量課金

### Claude API
- 使用モデル: `claude-3-5-sonnet-20241022`
- 料金は使用量に応じて変動
- [Anthropic Pricing](https://www.anthropic.com/pricing) を参照

### GitHub
- Webhook は無料

## カスタマイズ

### レビュープロンプトの変更

`src/index.ts` の `buildReviewPrompt()` 関数を編集して、レビュー基準やフォーマットをカスタマイズできます。

### 対象ファイルのフィルタリング

特定の拡張子のみレビューする場合：

```typescript
const filteredFiles = files.filter(file =>
  file.filename.endsWith('.ts') || file.filename.endsWith('.tsx')
);
```

### レビューモデルの変更

より高度なレビューが必要な場合は、モデルを変更：

```typescript
model: 'claude-3-opus-20240229',  // より高性能なモデル
max_tokens: 8000,                  // より長いレビュー
```

## セキュリティ

- ✅ Webhook 署名検証で不正なリクエストを拒否
- ✅ シークレットは Cloudflare Workers Secrets で管理
- ✅ GitHub Token は最小権限（`repo` のみ）
- ✅ HTTPS 通信のみ

## ライセンス

MIT

## サポート

問題が発生した場合は、GitHub Issues で報告してください。

---

**Powered by Cloudflare Workers + Claude AI**
