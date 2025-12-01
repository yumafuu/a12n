/**
 * GitHub PR Auto Review Worker
 *
 * This Cloudflare Worker receives GitHub webhooks for pull requests,
 * analyzes the code changes using Claude API, and posts review comments.
 */

import { Octokit } from 'octokit';
import Anthropic from '@anthropic-ai/sdk';

interface Env {
	GITHUB_WEBHOOK_SECRET: string;
	GITHUB_TOKEN: string;
	ANTHROPIC_API_KEY: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Health check endpoint
		if (url.pathname === '/' && request.method === 'GET') {
			return new Response('GitHub PR Auto Review Service is running', { status: 200 });
		}

		// GitHub webhook endpoint
		if (url.pathname === '/webhook/github' && request.method === 'POST') {
			return await handleGitHubWebhook(request, env, ctx);
		}

		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handle GitHub webhook events
 */
async function handleGitHubWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	try {
		// Verify webhook signature
		const signature = request.headers.get('X-Hub-Signature-256');
		if (!signature) {
			return new Response('Missing signature', { status: 401 });
		}

		const payload = await request.text();
		const isValid = await verifyWebhookSignature(payload, signature, env.GITHUB_WEBHOOK_SECRET);
		if (!isValid) {
			return new Response('Invalid signature', { status: 401 });
		}

		// Parse webhook event
		const event = request.headers.get('X-GitHub-Event');
		const data = JSON.parse(payload);

		console.log(`Received GitHub event: ${event}`);

		// Handle pull_request events
		if (event === 'pull_request') {
			const action = data.action;

			// Only process opened and synchronize (new commits) events
			if (action === 'opened' || action === 'synchronize') {
				// Process asynchronously (don't block webhook response)
				ctx.waitUntil(processPullRequest(data, env));
				return new Response('PR review started', { status: 202 });
			}
		}

		return new Response('Event processed', { status: 200 });
	} catch (error) {
		console.error('Error handling webhook:', error);
		return new Response('Internal Server Error', { status: 500 });
	}
}

/**
 * Verify GitHub webhook signature using HMAC SHA-256
 */
async function verifyWebhookSignature(
	payload: string,
	signature: string,
	secret: string
): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
	const hexHash = Array.from(new Uint8Array(signed))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');

	const expected = `sha256=${hexHash}`;
	return signature === expected;
}

/**
 * Process pull request: fetch diff, review with Claude, post comments
 */
async function processPullRequest(data: any, env: Env): Promise<void> {
	try {
		const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
		const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

		const repo = data.repository;
		const pr = data.pull_request;

		console.log(`Processing PR #${pr.number} in ${repo.full_name}`);

		// Fetch PR diff
		const { data: files } = await octokit.rest.pulls.listFiles({
			owner: repo.owner.login,
			repo: repo.name,
			pull_number: pr.number,
		});

		// Build diff summary
		let diffSummary = `# Pull Request Review\n\n`;
		diffSummary += `**Repository:** ${repo.full_name}\n`;
		diffSummary += `**PR:** #${pr.number} - ${pr.title}\n`;
		diffSummary += `**Author:** ${pr.user.login}\n\n`;
		diffSummary += `## Changed Files (${files.length})\n\n`;

		for (const file of files) {
			diffSummary += `### ${file.filename}\n`;
			diffSummary += `**Status:** ${file.status}\n`;
			diffSummary += `**Changes:** +${file.additions} -${file.deletions}\n\n`;
			if (file.patch) {
				diffSummary += '```diff\n' + file.patch + '\n```\n\n';
			}
		}

		// Get review from Claude with KOS assessment criteria
		const reviewPrompt = buildReviewPrompt(diffSummary);
		const message = await anthropic.messages.create({
			model: 'claude-3-5-sonnet-20241022',
			max_tokens: 4000,
			messages: [
				{
					role: 'user',
					content: reviewPrompt,
				},
			],
		});

		const reviewContent = message.content[0].type === 'text' ? message.content[0].text : '';

		// Post review comment to PR
		await octokit.rest.issues.createComment({
			owner: repo.owner.login,
			repo: repo.name,
			issue_number: pr.number,
			body: `## 🤖 Automated Code Review\n\n${reviewContent}\n\n---\n*Powered by Claude AI via Cloudflare Workers*`,
		});

		console.log(`Review posted successfully for PR #${pr.number}`);
	} catch (error) {
		console.error('Error processing PR:', error);
		throw error;
	}
}

/**
 * Build review prompt with KOS assessment criteria
 */
function buildReviewPrompt(diffSummary: string): string {
	return `You are an expert code reviewer. Please review the following pull request changes.

${diffSummary}

Please provide a thorough code review covering:

## KOS Assessment Criteria (Reference Guidelines)

### 1. Code Quality
- **Readability**: Is the code easy to understand?
- **Maintainability**: Can the code be easily modified in the future?
- **Consistency**: Does it follow the project's coding standards?

### 2. Security
- **Input Validation**: Are inputs properly validated and sanitized?
- **Authentication/Authorization**: Are access controls correctly implemented?
- **Data Protection**: Is sensitive data properly handled?
- **Dependency Security**: Are dependencies up-to-date and secure?

### 3. Performance
- **Efficiency**: Are algorithms and data structures optimal?
- **Resource Usage**: Is memory and CPU usage reasonable?
- **Scalability**: Can the code handle increased load?

### 4. Testing
- **Test Coverage**: Are there adequate tests?
- **Edge Cases**: Are edge cases handled?
- **Error Handling**: Are errors properly caught and handled?

### 5. Documentation
- **Code Comments**: Are complex sections well-documented?
- **API Documentation**: Are public interfaces documented?
- **README Updates**: Is documentation updated if needed?

### 6. Best Practices
- **Design Patterns**: Are appropriate patterns used?
- **DRY Principle**: Is code duplication avoided?
- **SOLID Principles**: Are OOP principles followed?

---

Please structure your review as follows:

### Summary
Brief overview of the changes

### Strengths
What's done well

### Issues Found
List any problems with severity (Critical/Major/Minor)

### Recommendations
Suggestions for improvement

### Security Concerns
Any security-related issues (if applicable)

Keep your review constructive, specific, and actionable.`;
}
