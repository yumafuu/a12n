import { WebClient } from "@slack/web-api";

export class SlackService {
  private client: WebClient;
  private channelId: string;

  constructor(token: string, channelId: string) {
    this.client = new WebClient(token);
    this.channelId = channelId;
  }

  /**
   * Issue回答ドラフトをSlackに投稿
   */
  async postIssueDraft(params: {
    issueUrl: string;
    issueTitle: string;
    issueBody: string;
    draftAnswer: string;
  }): Promise<{ ts: string; channel: string }> {
    const { issueUrl, issueTitle, issueBody, draftAnswer } = params;

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🤖 新しいIssueに対する回答ドラフト",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Issue:* <${issueUrl}|${issueTitle}>`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*質問内容:*\n${this.truncate(issueBody, 500)}`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*AI生成回答ドラフト:*\n${draftAnswer}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✅ 承認して投稿",
              emoji: true,
            },
            style: "primary",
            value: issueUrl,
            action_id: "approve_draft",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "✏️ 編集する",
              emoji: true,
            },
            value: issueUrl,
            action_id: "edit_draft",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "❌ 却下",
              emoji: true,
            },
            style: "danger",
            value: issueUrl,
            action_id: "reject_draft",
          },
        ],
      },
    ];

    const result = await this.client.chat.postMessage({
      channel: this.channelId,
      text: `新しいIssueに対する回答ドラフトが生成されました: ${issueTitle}`,
      blocks,
    });

    if (!result.ok || !result.ts || !result.channel) {
      throw new Error("Failed to post message to Slack");
    }

    return {
      ts: result.ts,
      channel: result.channel,
    };
  }

  /**
   * スレッドに返信
   */
  async replyToThread(params: {
    channel: string;
    threadTs: string;
    text: string;
  }): Promise<void> {
    const { channel, threadTs, text } = params;

    const result = await this.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text,
    });

    if (!result.ok) {
      throw new Error("Failed to reply to thread");
    }
  }

  /**
   * 文字列を指定文字数で切り詰め
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + "...";
  }
}
