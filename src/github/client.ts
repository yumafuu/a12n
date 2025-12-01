/**
 * GitHub Octokit クライアントの初期化
 */

import { Octokit } from '@octokit/rest';

export interface GitHubClientConfig {
  token: string;
}

/**
 * Octokit クライアントを初期化する
 */
export function createGitHubClient(config: GitHubClientConfig): Octokit {
  const octokit = new Octokit({
    auth: config.token,
    userAgent: 'aiorchestration-bot/1.0.0',
  });

  console.log('✓ GitHub Octokit client initialized');

  return octokit;
}

/**
 * GitHub クライアントの接続を確認する
 */
export async function verifyGitHubConnection(octokit: Octokit): Promise<void> {
  try {
    const { data } = await octokit.users.getAuthenticated();
    console.log(`✓ GitHub connection verified (authenticated as: ${data.login})`);
  } catch (error) {
    console.error('✗ Failed to verify GitHub connection:', error);
    throw error;
  }
}
