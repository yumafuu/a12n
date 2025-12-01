# デプロイガイド

## 前提条件

- Bun がインストールされていること
- Cloudflare アカウントを持っていること
- GitHub リポジトリへのアクセス権があること
- Anthropic API キーを持っていること

## ステップ 1: Cloudflare へのログイン

```bash
bunx wrangler login
```

ブラウザが開き、Cloudflare へのログインを求められます。

## ステップ 2: シークレットの設定

### GitHub Webhook Secret の設定

まず、強力なランダム文字列を生成します：

```bash
# macOS/Linux
openssl rand -hex 32
```

生成された文字列をコピーして設定：

```bash
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
# プロンプトで生成した文字列を入力
```

### GitHub Token の設定

1. GitHub で Personal Access Token を作成:
   - https://github.com/settings/tokens/new
   - Note: "Cloudflare Auto Review"
   - Expiration: 任意（90日推奨）
   - Scopes: `repo` にチェック
   - "Generate token" をクリック

2. トークンを設定:
```bash
bunx wrangler secret put GITHUB_TOKEN
# プロンプトで ghp_xxx... のトークンを入力
```

### Anthropic API Key の設定

1. Anthropic Console でキーを作成:
   - https://console.anthropic.com/settings/keys
   - "Create Key" をクリック

2. キーを設定:
```bash
bunx wrangler secret put ANTHROPIC_API_KEY
# プロンプトで sk-ant-xxx... のキーを入力
```

## ステップ 3: デプロイ

```bash
bun run deploy
```

成功すると、Worker の URL が表示されます：

```
Published cloudflare-auto-review (0.01 sec)
  https://cloudflare-auto-review.<your-subdomain>.workers.dev
```

この URL をメモしてください。

## ステップ 4: GitHub Webhook の設定

1. 対象リポジトリに移動
2. Settings → Webhooks → Add webhook
3. 以下を入力:

| 項目 | 値 |
|------|------|
| Payload URL | `https://cloudflare-auto-review.<your-subdomain>.workers.dev/webhook/github` |
| Content type | `application/json` |
| Secret | ステップ2で設定した `GITHUB_WEBHOOK_SECRET` の値 |
| SSL verification | Enable SSL verification (デフォルト) |
| Which events | "Let me select individual events" → `Pull requests` のみチェック |
| Active | チェック |

4. "Add webhook" をクリック

## ステップ 5: 動作確認

### 5-1. Worker のヘルスチェック

```bash
curl https://cloudflare-auto-review.<your-subdomain>.workers.dev/
```

レスポンス:
```
GitHub PR Auto Review Service is running
```

### 5-2. テスト PR の作成

1. 対象リポジトリで新しいブランチを作成:
```bash
git checkout -b test/auto-review
```

2. ファイルを編集して commit:
```bash
echo "# Test" > test.md
git add test.md
git commit -m "test: Add test file for auto review"
git push origin test/auto-review
```

3. GitHub で Pull Request を作成

4. 数秒後、PR に自動レビューコメントが投稿されることを確認

### 5-3. ログの確認

リアルタイムでログを確認:

```bash
bunx wrangler tail
```

## トラブルシューティング

### デプロイエラー

```
Error: No account_id found
```

→ `wrangler login` を実行してください

### Webhook エラー

GitHub の Webhooks ページで "Recent Deliveries" を確認:
- ✅ 緑のチェックマーク: 成功
- ❌ 赤の X マーク: 失敗（クリックして詳細を確認）

### シークレットの確認

現在設定されているシークレットのリスト:

```bash
bunx wrangler secret list
```

シークレットの削除（再設定が必要な場合）:

```bash
bunx wrangler secret delete GITHUB_WEBHOOK_SECRET
```

## 更新とロールバック

### コードの更新

1. コードを編集
2. 再デプロイ:
```bash
bun run deploy
```

### ロールバック

Cloudflare Dashboard から:
1. Workers & Pages → cloudflare-auto-review
2. Deployments タブ
3. 以前のデプロイメントを選択 → "Rollback to this deployment"

## モニタリング

### Cloudflare Dashboard

https://dash.cloudflare.com/ → Workers & Pages → cloudflare-auto-review

確認できる情報:
- リクエスト数
- エラー率
- CPU 使用時間
- ログ

### アラート設定

1. Cloudflare Dashboard → Notifications
2. "Add" → "Workers"
3. 条件を設定（例: エラー率 > 5%）

## コスト管理

### 使用量の確認

Cloudflare Dashboard → Workers & Pages → cloudflare-auto-review → Metrics

### 無料枠の上限

- 100,000 リクエスト/日
- 超過すると自動的に Paid Plan に移行

### 使用量制限の設定

過剰な使用を防ぐため、リポジトリ数や PR 頻度を考慮してください。

## セキュリティのベストプラクティス

1. ✅ GitHub Token の定期的なローテーション（90日ごと推奨）
2. ✅ Webhook Secret の強力な値の使用
3. ✅ 最小権限の原則（必要なリポジトリのみ）
4. ✅ ログの定期的な確認

## まとめ

デプロイが完了したら、以下を確認してください：

- [ ] Worker がデプロイされている
- [ ] シークレットが設定されている
- [ ] GitHub Webhook が設定されている
- [ ] テスト PR で動作確認済み
- [ ] ログが正常に出力されている

問題がある場合は、README.md のトラブルシューティングセクションを参照してください。
