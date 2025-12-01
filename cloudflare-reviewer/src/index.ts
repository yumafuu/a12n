import type { Env, GitHubWebhookPayload } from './types';
import { verifyWebhookSignature } from './webhook-verify';
import { reviewPullRequest, postReviewComment } from './reviewer';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // GitHub Webhook endpoint
    if (url.pathname === '/webhook/github' && request.method === 'POST') {
      return handleGitHubWebhook(request, env, ctx);
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * GitHub Webhook を処理
 */
async function handleGitHubWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    // Verify webhook signature
    const signature = request.headers.get('X-Hub-Signature-256');
    const payload = await request.text();

    if (!signature) {
      return new Response('Missing signature', { status: 401 });
    }

    const isValid = await verifyWebhookSignature(
      payload,
      signature,
      env.GITHUB_WEBHOOK_SECRET
    );

    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response('Invalid signature', { status: 401 });
    }

    // Parse payload
    const webhookPayload: GitHubWebhookPayload = JSON.parse(payload);
    console.log('Received webhook:', webhookPayload.action);

    // Handle pull_request events
    if (webhookPayload.pull_request && webhookPayload.repository) {
      const { action, pull_request, repository } = webhookPayload;

      // Trigger review on PR opened or synchronized (new commits pushed)
      if (action === 'opened' || action === 'synchronize') {
        const owner = repository.owner.login;
        const repo = repository.name;
        const prNumber = pull_request.number;

        console.log(`Triggering review for PR #${prNumber} in ${owner}/${repo}`);

        // Run review in background using ctx.waitUntil to ensure completion
        ctx.waitUntil(runReview(env, owner, repo, prNumber));

        return new Response('Review triggered', { status: 200 });
      }
    }

    return new Response('Event ignored', { status: 200 });
  } catch (error) {
    console.error('Error handling webhook:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * レビューを実行（非同期処理）
 */
async function runReview(
  env: Env,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  try {
    console.log(`Starting review for ${owner}/${repo} PR #${prNumber}`);

    // Generate review
    const reviewText = await reviewPullRequest(env, owner, repo, prNumber);

    // Post comment
    await postReviewComment(env, owner, repo, prNumber, reviewText);

    console.log(`Review completed for PR #${prNumber}`);
  } catch (error) {
    console.error(`Error during review for PR #${prNumber}:`, error);
  }
}
