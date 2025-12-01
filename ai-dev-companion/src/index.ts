import { Hono } from 'hono';
import type { Env } from './types';
import { handleGitHubWebhook } from './handlers/github-webhook';
import { handleSlackWebhook } from './handlers/slack-webhook';

const app = new Hono<{ Bindings: Env }>();

/**
 * Health check endpoint
 */
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'AI Development Companion',
    version: '0.1.0',
  });
});

/**
 * GitHub webhook endpoint
 */
app.post('/webhook/github', async (c) => {
  return await handleGitHubWebhook(c.req.raw, c.env, c.executionCtx);
});

/**
 * Slack webhook endpoint
 */
app.post('/webhook/slack', async (c) => {
  return await handleSlackWebhook(c.req.raw, c.env, c.executionCtx);
});

export default app;
