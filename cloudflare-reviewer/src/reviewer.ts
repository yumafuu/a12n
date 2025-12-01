import { Octokit } from 'octokit';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { getReviewCriteriaAsText } from './review-criteria';

// Claude API の context window を考慮した diff サイズの上限
const MAX_DIFF_LENGTH = 50000;

/**
 * PR のコードレビューを実行
 */
export async function reviewPullRequest(
  env: Env,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  let fullDiff = '';
  let diffTruncated = false;

  try {
    // GitHub API client
    const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

    // PR の diff を取得
    console.log(`Fetching PR #${prNumber} diff for ${owner}/${repo}`);
    const { data: prFiles } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    // diff を結合
    for (const file of prFiles) {
      fullDiff += `\n--- ${file.filename} ---\n`;
      if (file.patch) {
        fullDiff += file.patch + '\n';
      } else {
        fullDiff += '(No diff available - binary or too large)\n';
      }
    }

    if (!fullDiff.trim()) {
      return '変更内容が見つかりませんでした。';
    }

    // diff サイズ制限（Claude の context window を超えないように）
    if (fullDiff.length > MAX_DIFF_LENGTH) {
      console.warn(`Diff size (${fullDiff.length}) exceeds limit (${MAX_DIFF_LENGTH}), truncating...`);
      fullDiff = fullDiff.slice(0, MAX_DIFF_LENGTH);
      diffTruncated = true;
    }
  } catch (error) {
    console.error('Error fetching PR diff:', error);
    if (error instanceof Error && error.message.includes('rate limit')) {
      return 'GitHub API のレート制限に達しました。しばらく待ってから再試行してください。';
    }
    throw error;
  }

  try {
    // Claude API でレビューを生成
    console.log('Generating review with Claude API');
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const reviewCriteria = getReviewCriteriaAsText();

    const prompt = `あなたはコードレビューアです。以下の Pull Request の diff を確認し、コードレビューを実施してください。

${reviewCriteria}

## レビュー対象の diff

${diffTruncated ? '⚠️ **注意**: Diff が大きすぎるため、一部のみを表示しています。\n\n' : ''}\`\`\`diff
${fullDiff}
\`\`\`
${diffTruncated ? '\n... (truncated)' : ''}

## レビュー形式

以下の形式でレビュー結果を返してください：

1. **概要**: 変更内容の要約
2. **良い点**: 良く書けている部分
3. **改善提案**: 上記のレビュー基準に基づいて、改善が必要な箇所を具体的に指摘
4. **総合評価**: 全体的な評価（Approve / Request Changes / Comment）

具体的で建設的なフィードバックを心がけてください。`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const reviewContent = message.content[0];
    if (reviewContent.type === 'text') {
      return reviewContent.text;
    }

    return 'レビューの生成に失敗しました。';
  } catch (error) {
    console.error('Error generating review with Claude API:', error);
    if (error instanceof Error && error.message.includes('rate_limit')) {
      return 'Claude API のレート制限に達しました。しばらく待ってから再試行してください。';
    }
    throw error;
  }
}

/**
 * レビュー結果を GitHub PR にコメントとして投稿
 */
export async function postReviewComment(
  env: Env,
  owner: string,
  repo: string,
  prNumber: number,
  reviewText: string
): Promise<void> {
  try {
    const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `## 🤖 自動コードレビュー\n\n${reviewText}`,
    });

    console.log(`Posted review comment to PR #${prNumber}`);
  } catch (error) {
    console.error('Error posting review comment:', error);
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new Error('GitHub API のレート制限に達しました。');
    }
    throw error;
  }
}
