import Anthropic from '@anthropic-ai/sdk';

/**
 * Generate code review comments using Claude API
 */
export async function generateCodeReview(
  apiKey: string,
  diff: string,
  prTitle: string,
  prBody: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const prompt = `You are an expert code reviewer. Please review the following pull request.

**PR Title**: ${prTitle}

**PR Description**:
${prBody || 'No description provided.'}

**Diff**:
\`\`\`diff
${diff}
\`\`\`

Please provide:
1. A summary of the changes
2. Potential issues or bugs
3. Suggestions for improvement
4. Security concerns (if any)
5. Performance considerations

Keep your review constructive and actionable.`;

  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent
    ? textContent.text
    : 'No review generated.';
}

/**
 * Generate draft response for GitHub issue
 */
export async function generateIssueResponse(
  apiKey: string,
  issueTitle: string,
  issueBody: string,
  repoContext: string,
  kosAssessment: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const prompt = `You are a technical consultant helping answer a GitHub issue.

**Repository Context**:
${repoContext}

**KOS Assessment Data**:
${kosAssessment}

**Issue Title**: ${issueTitle}

**Issue Body**:
${issueBody || 'No description provided.'}

Please generate a helpful response draft. Include:
1. Understanding of the issue
2. Relevant information from the repository context
3. Suggested solution or next steps
4. Any additional resources or references

Keep the tone professional and helpful.`;

  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent
    ? textContent.text
    : 'No response generated.';
}

/**
 * Update issue response based on feedback
 */
export async function updateIssueResponse(
  apiKey: string,
  originalResponse: string,
  feedback: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const prompt = `You previously generated the following response:

**Original Response**:
${originalResponse}

**Feedback from consultant**:
${feedback}

Please update the response based on this feedback. Maintain a professional and helpful tone.`;

  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = message.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent
    ? textContent.text
    : 'No updated response generated.';
}
