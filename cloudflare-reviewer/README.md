# GitHub Code Reviewer - Cloudflare Workers

GitHub Pull Request の自動コードレビューシステム。Cloudflare Workers 上で動作し、PR が作成されると Claude API を使用して自動的にコードレビューを実施します。

## 特徴

- ⚡ **高速**: Cloudflare Workers のエッジネットワークで高速に動作
- 🤖 **AI レビュー**: Claude API による高品質なコードレビュー
- 🔒 **セキュア**: Webhook 署名検証による安全な通信
- 📋 **KOS アセスメント**: 独自のレビュー基準に基づいた評価

## アーキテクチャ

```
GitHub PR (opened/synchronize)
  ↓
GitHub Webhook
  ↓
Cloudflare Workers
  ├─ Webhook 署名検証
  ├─ PR Diff 取得 (Octokit)
  ├─ Claude API でレビュー生成
  └─ GitHub にコメント投稿
```

## 技術スタック

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Development**: Bun + Wrangler
- **GitHub Integration**: Octokit
- **AI**: Claude API (Anthropic)

## セットアップ

### 1. 依存関係のインストール

```bash
bun install
```

### 2. 環境変数の設定

Cloudflare Workers のシークレットを設定します：

```bash
# GitHub Webhook Secret
wrangler secret put GITHUB_WEBHOOK_SECRET

# GitHub Personal Access Token (repo scope required)
wrangler secret put GITHUB_TOKEN

# Anthropic API Key
wrangler secret put ANTHROPIC_API_KEY
```

#### 各キーの取得方法

**GITHUB_WEBHOOK_SECRET**
- 任意の秘密文字列を生成（例: `openssl rand -hex 32`）
- GitHub リポジトリの Webhook 設定時に同じ値を使用

**GITHUB_TOKEN**
- GitHub Settings → Developer settings → Personal access tokens
- `repo` スコープを付与

**ANTHROPIC_API_KEY**
- [Anthropic Console](https://console.anthropic.com/) で取得

### 3. GitHub Webhook の設定

対象リポジトリで以下の設定を行います：

1. Settings → Webhooks → Add webhook
2. Payload URL: `https://your-worker.workers.dev/webhook/github`
3. Content type: `application/json`
4. Secret: `GITHUB_WEBHOOK_SECRET` と同じ値
5. Events: "Let me select individual events" → `Pull requests` にチェック
6. Active にチェックを入れて保存

## ローカル開発

### 開発サーバーの起動

```bash
bun run dev
```

Wrangler が `localhost:8787` でローカルサーバーを起動します。

### ローカルでの Webhook テスト

ngrok などを使用して localhost を公開し、GitHub Webhook の URL を設定することで、実際の GitHub イベントでテストできます。

```bash
# ngrok のインストール・起動
ngrok http 8787

# 表示された URL (例: https://xxxx.ngrok.io) を GitHub Webhook に設定
```

### 手動テスト

```bash
curl -X POST http://localhost:8787/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"action":"opened","pull_request":{...}}'
```

## デプロイ

### Cloudflare Workers へのデプロイ

```bash
bun run deploy
```

または

```bash
wrangler deploy
```

デプロイ後、表示された Worker URL を GitHub Webhook に設定します。

### デプロイ後の確認

```bash
# Health check
curl https://your-worker.workers.dev/health
```

## プロジェクト構成

```
cloudflare-reviewer/
├── src/
│   ├── index.ts              # メインエントリーポイント
│   ├── types.ts              # 型定義
│   ├── webhook-verify.ts     # Webhook 署名検証
│   ├── reviewer.ts           # レビュー処理
│   └── review-criteria.ts    # KOS アセスメント基準
├── wrangler.toml             # Cloudflare Workers 設定
├── tsconfig.json             # TypeScript 設定
├── package.json              # 依存関係
└── README.md                 # このファイル
```

## レビュー基準（KOS アセスメント）

レビューは以下の基準に基づいて実施されます（`src/review-criteria.ts` で定義）：

- **セキュリティ**: 認証情報の漏洩、SQLインジェクション、XSS 対策など
- **コーディング規約**: 命名規則、コメント、未使用コードの削除など
- **パフォーマンス**: 不要なループ、メモリ効率、非同期処理など
- **エラーハンドリング**: 例外処理、エラーメッセージ、リソース管理など
- **テスタビリティ**: 単一責任原則、依存性注入など

これらの基準は `review-criteria.ts` を編集することでカスタマイズ可能です。

## 動作フロー

1. PR が作成 or 更新されると GitHub Webhook が発火
2. Worker が Webhook を受信し、署名を検証
3. Octokit で PR の diff を取得
4. Claude API にレビュー基準と diff を送信
5. Claude がレビュー結果を生成
6. GitHub PR にコメントとして投稿

## トラブルシューティング

### Webhook が届かない

- GitHub Webhook 設定の "Recent Deliveries" でエラーを確認
- 署名検証が失敗していないか確認
- Worker のログを確認: `wrangler tail`

### レビューが投稿されない

- `GITHUB_TOKEN` のスコープが `repo` を含んでいるか確認
- Claude API のレート制限に達していないか確認
- Worker のログを確認

### ローカル開発時の接続エラー

- `wrangler dev` でサーバーが起動しているか確認
- シークレットがローカル環境で設定されているか確認（`.dev.vars` ファイルを使用）

## ライセンス

MIT

## 参考リンク

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Octokit Documentation](https://octokit.github.io/rest.js/)
- [Anthropic API Documentation](https://docs.anthropic.com/)
