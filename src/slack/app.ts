/**
 * Slack Bolt アプリの初期化（Socket Mode）
 */

import { App, LogLevel } from '@slack/bolt';

export interface SlackAppConfig {
  token: string;
  appToken: string;
  signingSecret: string;
}

/**
 * Slack Bolt アプリを Socket Mode で初期化する
 */
export function createSlackApp(config: SlackAppConfig): App {
  const app = new App({
    token: config.token,
    appToken: config.appToken,
    signingSecret: config.signingSecret,
    socketMode: true,
    logLevel: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  });

  // アプリ起動時のログ
  app.event('app_home_opened', async ({ logger }) => {
    logger.info('App Home was opened');
  });

  return app;
}

/**
 * Slack アプリを起動する
 */
export async function startSlackApp(app: App): Promise<void> {
  await app.start();
  console.log('⚡️ Slack Bolt app is running (Socket Mode)');
}
