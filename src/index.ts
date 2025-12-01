/**
 * Bolt + Octokit 基盤アプリケーションのエントリーポイント
 */

import { loadEnv } from './config/env.js';
import { createSlackApp, startSlackApp } from './slack/app.js';
import { createGitHubClient, verifyGitHubConnection } from './github/client.js';

async function main() {
  console.log('🚀 Starting Bolt + Octokit application...\n');

  try {
    // 環境変数の読み込み
    console.log('📋 Loading environment variables...');
    const env = loadEnv();
    console.log('✓ Environment variables loaded\n');

    // GitHub クライアントの初期化
    console.log('🔧 Initializing GitHub client...');
    const githubClient = createGitHubClient({
      token: env.GITHUB_TOKEN,
    });
    await verifyGitHubConnection(githubClient);
    console.log('');

    // Slack アプリの初期化と起動
    console.log('🔧 Initializing Slack app...');
    const slackApp = createSlackApp({
      token: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
    });
    await startSlackApp(slackApp);
    console.log('');

    console.log('✅ Application started successfully!');
    console.log('Press Ctrl+C to stop\n');

  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// アプリケーション起動
main();
