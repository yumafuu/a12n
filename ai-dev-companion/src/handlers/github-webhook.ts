import type { Env } from '../types';
import { verifyGitHubSignature, parseRepoFullName } from '../utils/github';
import { generateCodeReview, generateIssueResponse } from '../services/claude';
import {
  getPRDiff,
  postPRComment,
  getRepoFileTree,
  getRepoReadme,
} from '../services/github';
import {
  postSlackMessage,
  createIssueResponseBlocks,
} from '../services/slack';
import { mockKOSAssessment } from '../data/kos-assessment-mock';

/**
 * Handle GitHub webhook events
 */
export async function handleGitHubWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify signature
  const signature = request.headers.get('X-Hub-Signature-256');
  const body = await request.text();

  if (!verifyGitHubSignature(body, signature, env.GITHUB_WEBHOOK_SECRET)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(body);
  const event = request.headers.get('X-GitHub-Event');

  console.log(`Received GitHub event: ${event}`);

  try {
    if (event === 'pull_request') {
      return await handlePullRequest(payload, env);
    } else if (event === 'issues') {
      return await handleIssue(payload, env);
    } else if (event === 'ping') {
      return new Response('pong', { status: 200 });
    } else {
      return new Response('Event not supported', { status: 200 });
    }
  } catch (error) {
    console.error('Error handling GitHub webhook:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

/**
 * Handle pull_request event (opened, synchronize)
 */
async function handlePullRequest(payload: any, env: Env): Promise<Response> {
  const action = payload.action;

  if (action !== 'opened' && action !== 'synchronize') {
    return new Response('PR action not relevant', { status: 200 });
  }

  const pr = payload.pull_request;
  const repo = payload.repository;
  const { owner, repo: repoName } = parseRepoFullName(repo.full_name);

  console.log(
    `Processing PR #${pr.number}: ${pr.title} (${owner}/${repoName})`
  );

  // Get PR diff
  const diff = await getPRDiff(env.GITHUB_TOKEN, owner, repoName, pr.number);

  // Generate review using Claude
  const review = await generateCodeReview(
    env.ANTHROPIC_API_KEY,
    diff,
    pr.title,
    pr.body || ''
  );

  // Post review comment on PR
  await postPRComment(env.GITHUB_TOKEN, owner, repoName, pr.number, review);

  console.log(`Posted review on PR #${pr.number}`);

  return new Response('Review posted', { status: 200 });
}

/**
 * Handle issues event (opened)
 */
async function handleIssue(payload: any, env: Env): Promise<Response> {
  const action = payload.action;

  if (action !== 'opened') {
    return new Response('Issue action not relevant', { status: 200 });
  }

  const issue = payload.issue;
  const repo = payload.repository;
  const { owner, repo: repoName } = parseRepoFullName(repo.full_name);

  console.log(
    `Processing issue #${issue.number}: ${issue.title} (${owner}/${repoName})`
  );

  // Get repository context
  const fileTree = await getRepoFileTree(env.GITHUB_TOKEN, owner, repoName);
  const readme = await getRepoReadme(env.GITHUB_TOKEN, owner, repoName);

  const repoContext = `**README**:\n${readme}\n\n**File structure**:\n${fileTree}`;
  const kosAssessmentText = `
**Project**: ${mockKOSAssessment.project_name}
**Overview**: ${mockKOSAssessment.overview}
**Tech Stack**: ${mockKOSAssessment.tech_stack.join(', ')}
**Common Issues**: ${mockKOSAssessment.common_issues.join('; ')}
  `.trim();

  // Generate issue response draft using Claude
  const responseDraft = await generateIssueResponse(
    env.ANTHROPIC_API_KEY,
    issue.title,
    issue.body || '',
    repoContext,
    kosAssessmentText
  );

  // Post to Slack
  const slackChannel = env.SLACK_CHANNEL_ID || 'general';
  const blocks = createIssueResponseBlocks(
    issue.title,
    issue.html_url,
    responseDraft
  );

  const { ts, channel } = await postSlackMessage(
    env.SLACK_BOT_TOKEN,
    slackChannel,
    `New issue response draft for: ${issue.title}`,
    blocks
  );

  console.log(
    `Posted issue response draft to Slack (channel: ${channel}, ts: ${ts})`
  );

  // Store metadata for later approval (in production, use KV or Durable Objects)
  // For now, we'll encode it in the message itself or rely on thread_ts
  // This is a simplified approach; consider using KV storage for production

  return new Response('Issue response draft posted to Slack', { status: 200 });
}
