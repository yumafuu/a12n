import Anthropic from '@anthropic-ai/sdk';
import type { PRDiff, ClaudeReviewResponse } from '../types/index.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Generate a code review using Claude API
 * @param prTitle - Pull request title
 * @param prBody - Pull request description
 * @param diffs - Array of file diffs
 * @returns Review response with summary and comments
 */
export async function generateReview(
  prTitle: string,
  prBody: string | null,
  diffs: PRDiff[]
): Promise<ClaudeReviewResponse> {
  // Format diffs for Claude
  const diffText = diffs
    .map((diff) => {
      return `
## File: ${diff.filename}
Status: ${diff.status}
Changes: +${diff.additions} -${diff.deletions}

${diff.patch || 'No patch available'}
`;
    })
    .join('\n---\n');

  const prompt = `You are a code reviewer. Review the following pull request and provide constructive feedback.

**PR Title:** ${prTitle}
**PR Description:** ${prBody || 'No description provided'}

**Changed Files:**
${diffText}

Please provide:
1. A brief summary of the changes (2-3 sentences)
2. Specific comments on code quality, potential bugs, or improvements
3. An overall assessment (LGTM, Needs Changes, or Needs Discussion)

Format your response as JSON with the following structure:
{
  "summary": "Brief summary of changes",
  "comments": [
    {
      "path": "filename",
      "line": line_number,
      "body": "Comment text"
    }
  ],
  "overallAssessment": "LGTM | Needs Changes | Needs Discussion"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text content from the response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }

    // Parse JSON from the response
    // Claude might wrap JSON in markdown code blocks, so we need to extract it
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    const reviewResponse: ClaudeReviewResponse = JSON.parse(jsonText);
    return reviewResponse;
  } catch (error) {
    console.error('Error generating review with Claude:', error);

    // Return a fallback response
    return {
      summary: 'Error occurred while generating review. Please review manually.',
      comments: [],
      overallAssessment: 'Needs Discussion',
    };
  }
}
