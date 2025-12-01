import express, { Request, Response } from 'express';
import { verifyGitHubWebhook } from '../utils/verify.js';
import { getPRDiff, postReviewComment, formatReviewComment } from '../services/github.js';
import { generateReview } from '../services/claude.js';
import type { GitHubWebhookPayload } from '../types/index.js';

const router = express.Router();

/**
 * GitHub webhook endpoint
 * Handles pull_request events (opened, synchronize)
 */
router.post('/webhook/github', async (req: Request, res: Response) => {
  try {
    // Get raw body for signature verification
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = JSON.stringify(req.body);

    // Verify webhook signature
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      console.error('GITHUB_WEBHOOK_SECRET is not set');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    if (!verifyGitHubWebhook(rawBody, signature, secret)) {
      console.error('Invalid webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Parse webhook payload
    const payload = req.body as GitHubWebhookPayload;
    const event = req.headers['x-github-event'] as string;

    // Only handle pull_request events
    if (event !== 'pull_request') {
      res.status(200).json({ message: 'Event ignored' });
      return;
    }

    // Only handle opened and synchronize actions
    if (payload.action !== 'opened' && payload.action !== 'synchronize') {
      res.status(200).json({ message: 'Action ignored' });
      return;
    }

    // Extract PR information
    const { owner, repo, prNumber, title, body } = {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      title: payload.pull_request.title,
      body: payload.pull_request.body,
    };

    console.log(`Processing PR #${prNumber} in ${owner}/${repo}`);

    // Get PR diff
    const diffs = await getPRDiff(owner, repo, prNumber);

    // Generate review using Claude
    const review = await generateReview(title, body, diffs);

    // Format and post review comment
    const comment = formatReviewComment(
      review.summary,
      review.comments,
      review.overallAssessment
    );

    await postReviewComment(owner, repo, prNumber, comment);

    console.log(`Successfully posted review for PR #${prNumber}`);
    res.status(200).json({ message: 'Review posted successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
