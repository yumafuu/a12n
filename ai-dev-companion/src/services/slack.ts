import { WebClient } from '@slack/web-api';

/**
 * Post message to Slack channel
 */
export async function postSlackMessage(
  token: string,
  channel: string,
  text: string,
  blocks?: any[]
): Promise<{ ts: string; channel: string }> {
  const client = new WebClient(token);

  const result = await client.chat.postMessage({
    channel,
    text,
    blocks,
  });

  return {
    ts: result.ts!,
    channel: result.channel!,
  };
}

/**
 * Post message to Slack thread
 */
export async function postSlackThreadReply(
  token: string,
  channel: string,
  threadTs: string,
  text: string
): Promise<void> {
  const client = new WebClient(token);

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
  });
}

/**
 * Add reaction to Slack message
 */
export async function addSlackReaction(
  token: string,
  channel: string,
  timestamp: string,
  name: string
): Promise<void> {
  const client = new WebClient(token);

  await client.reactions.add({
    channel,
    timestamp,
    name,
  });
}

/**
 * Create Slack message blocks with approval button
 */
export function createIssueResponseBlocks(
  issueTitle: string,
  issueUrl: string,
  responseDraft: string
): any[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📋 New Issue Response Draft',
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Issue:*\n<${issueUrl}|${issueTitle}>`,
        },
      ],
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Response Draft:*\n${responseDraft}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '✅ Approve & Post',
            emoji: true,
          },
          value: 'approve',
          action_id: 'approve_issue_response',
          style: 'primary',
        },
      ],
    },
  ];
}
