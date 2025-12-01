/**
 * 環境変数の読み込みとバリデーション
 */

interface EnvConfig {
  // Slack Configuration
  SLACK_BOT_TOKEN: string;
  SLACK_APP_TOKEN: string;
  SLACK_SIGNING_SECRET: string;

  // GitHub Configuration
  GITHUB_TOKEN: string;
}

/**
 * 環境変数を読み込み、必須項目が未設定ならエラーを投げる
 */
export function loadEnv(): EnvConfig {
  const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'SLACK_SIGNING_SECRET',
    'GITHUB_TOKEN',
  ] as const;

  const missingVars: string[] = [];

  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n` +
      `Please check your .env file and ensure all required variables are set.`
    );
  }

  return {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN!,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
  };
}
