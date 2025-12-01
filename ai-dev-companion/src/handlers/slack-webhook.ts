import type { Env } from '../types';
import { verifySlackSignature } from '../utils/slack';
import { updateIssueResponse } from '../services/claude';
import { postSlackThreadReply } from '../services/slack';
import { postIssueComment } from '../services/github';
import { findGitHubUsername } from '../data/user-mapping-mock';

/**
 * Handle Slack webhook events (interactive actions, message events, etc.)
 */
export async function handleSlackWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify Slack signature
  const signature = request.headers.get('X-Slack-Signature');
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const body = await request.text();

  if (
    !verifySlackSignature(
      env.SLACK_SIGNING_SECRET,
      signature,
      timestamp,
      body
    )
  ) {
    return new Response('Invalid signature', { status: 401 });
  }

  const contentType = request.headers.get('Content-Type');

  // Handle URL verification challenge (initial setup)
  if (contentType?.includes('application/json')) {
    const payload = JSON.parse(body);
    if (payload.type === 'url_verification') {
      return new Response(JSON.stringify({ challenge: payload.challenge }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle event subscriptions
    if (payload.type === 'event_callback') {
      return await handleSlackEvent(payload, env);
    }
  }

  // Handle interactive components (button clicks, etc.)
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);
    const payloadStr = params.get('payload');
    if (payloadStr) {
      const payload = JSON.parse(payloadStr);
      return await handleSlackInteraction(payload, env);
    }
  }

  return new Response('OK', { status: 200 });
}

/**
 * Handle Slack event subscriptions (message events, etc.)
 */
async function handleSlackEvent(payload: any, env: Env): Promise<Response> {
  const event = payload.event;

  // Handle thread replies (for updating issue response)
  if (event.type === 'message' && event.thread_ts && !event.bot_id) {
    return await handleThreadReply(event, env);
  }

  return new Response('OK', { status: 200 });
}

/**
 * Handle thread reply (update issue response based on feedback)
 */
async function handleThreadReply(event: any, env: Env): Promise<Response> {
  const threadTs = event.thread_ts;
  const channel = event.channel;
  const feedback = event.text;

  console.log(`Received thread reply: ${feedback}`);

  // In production, retrieve original response from KV storage using thread_ts
  // For this demo, we'll use a placeholder
  const originalResponse = '(Original response - would be retrieved from storage)';

  // Update response using Claude
  const updatedResponse = await updateIssueResponse(
    env.ANTHROPIC_API_KEY,
    originalResponse,
    feedback
  );

  // Post updated response to thread
  await postSlackThreadReply(
    env.SLACK_BOT_TOKEN,
    channel,
    threadTs,
    `*Updated Response:*\n${updatedResponse}`
  );

  console.log('Posted updated response to Slack thread');

  return new Response('OK', { status: 200 });
}

/**
 * Handle Slack interactive components (button clicks)
 */
async function handleSlackInteraction(
  payload: any,
  env: Env
): Promise<Response> {
  const actionId = payload.actions?.[0]?.action_id;

  if (actionId === 'approve_issue_response') {
    return await handleApproval(payload, env);
  }

  return new Response('OK', { status: 200 });
}

/**
 * Handle approval button click - post response to GitHub
 */
async function handleApproval(payload: any, env: Env): Promise<Response> {
  const user = payload.user;
  const message = payload.message;

  console.log(`Approval requested by Slack user: ${user.id}`);

  // Find GitHub username from Slack user ID
  const githubUsername = findGitHubUsername(user.id);

  // Extract issue info from message blocks
  // This is a simplified approach; in production, use KV storage
  const blocks = message.blocks;
  let issueUrl = '';
  let responseDraft = '';

  for (const block of blocks) {
    if (block.type === 'section' && block.fields) {
      const issueField = block.fields.find((f: any) =>
        f.text?.includes('Issue:')
      );
      if (issueField) {
        // Extract URL from markdown link <url|title>
        const match = issueField.text.match(/<([^|>]+)\|/);
        if (match) {
          issueUrl = match[1];
        }
      }
    }
    if (
      block.type === 'section' &&
      block.text?.text?.includes('Response Draft:')
    ) {
      responseDraft = block.text.text.replace(/\*\*Response Draft:\*\*\n/, '');
    }
  }

  if (!issueUrl || !responseDraft) {
    console.error('Failed to extract issue info from Slack message');
    return new Response('Failed to extract issue info', { status: 400 });
  }

  // Parse issue URL to get owner, repo, issue number
  // Example: https://github.com/owner/repo/issues/123
  const urlMatch = issueUrl.match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/
  );
  if (!urlMatch) {
    console.error('Invalid issue URL format');
    return new Response('Invalid issue URL', { status: 400 });
  }

  const [, owner, repo, issueNumberStr] = urlMatch;
  const issueNumber = parseInt(issueNumberStr, 10);

  console.log(
    `Posting approved response to ${owner}/${repo}#${issueNumber} as ${githubUsername || 'bot'}`
  );

  // Post comment to GitHub issue
  await postIssueComment(
    env.GITHUB_TOKEN,
    owner,
    repo,
    issueNumber,
    responseDraft,
    githubUsername || undefined
  );

  console.log('Posted approved response to GitHub');

  // Update Slack message to show approval
  return new Response(
    JSON.stringify({
      text: '✅ Response approved and posted to GitHub!',
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
