#!/usr/bin/env bun
import express from "express";
import { Octokit } from "@octokit/rest";
import { SlackService } from "./services/slack.js";
import { ClaudeService } from "./services/claude.js";
import { ThreadStateService } from "./services/thread-state.js";
import { SlackMessageHandler } from "./handlers/slack-message.js";
import { createGitHubRouter } from "./routes/github.js";
import { createSlackRouter } from "./routes/slack.js";

/**
 * 環境変数の検証
 */
function validateEnv(): {
  port: number;
  githubToken: string;
  slackBotToken: string;
  slackSigningSecret: string;
  slackChannelId: string;
  slackBotUserId: string;
  claudeApiKey: string;
} {
  const port = parseInt(process.env.PORT || "3000", 10);
  const githubToken = process.env.GITHUB_TOKEN;
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const slackChannelId = process.env.SLACK_CHANNEL_ID;
  const slackBotUserId = process.env.SLACK_BOT_USER_ID;
  const claudeApiKey = process.env.ANTHROPIC_API_KEY;

  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required");
  }
  if (!slackBotToken) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }
  if (!slackSigningSecret) {
    throw new Error("SLACK_SIGNING_SECRET is required");
  }
  if (!slackChannelId) {
    throw new Error("SLACK_CHANNEL_ID is required");
  }
  if (!slackBotUserId) {
    throw new Error("SLACK_BOT_USER_ID is required");
  }
  if (!claudeApiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  return {
    port,
    githubToken,
    slackBotToken,
    slackSigningSecret,
    slackChannelId,
    slackBotUserId,
    claudeApiKey,
  };
}

/**
 * メイン関数
 */
async function main() {
  const env = validateEnv();

  // サービスのインスタンスを作成
  const octokit = new Octokit({ auth: env.githubToken });
  const slackService = new SlackService(env.slackBotToken, env.slackChannelId);
  const claudeService = new ClaudeService(env.claudeApiKey);
  const threadStateService = new ThreadStateService();

  // Slack メッセージハンドラー（Phase 3）
  const slackMessageHandler = new SlackMessageHandler(
    slackService,
    claudeService,
    threadStateService,
    env.slackBotUserId
  );

  // Express アプリケーション
  const app = express();

  // JSON ボディパーサー
  app.use(express.json());

  // ヘルスチェック
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // GitHub webhook ルート
  const githubRouter = createGitHubRouter({
    octokit,
    slackService,
    claudeService,
    threadStateService, // Phase 3: スレッド状態管理
  });
  app.use(githubRouter);

  // Slack webhook ルート
  const slackRouter = createSlackRouter({
    slackSigningSecret: env.slackSigningSecret,
    octokit,
    slackMessageHandler, // Phase 3: スレッドコメント処理
  });
  app.use(slackRouter);

  // サーバー起動
  app.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
    console.log(`Health check: http://localhost:${env.port}/health`);
    console.log(`GitHub webhook: http://localhost:${env.port}/webhook/github`);
    console.log(`Slack webhook: http://localhost:${env.port}/webhook/slack`);
  });
}

// エラーハンドリング
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
