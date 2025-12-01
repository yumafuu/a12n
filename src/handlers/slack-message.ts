/**
 * Slack メッセージハンドラー
 * スレッド返信を処理して回答を更新
 */

import { SlackService } from "../services/slack.js";
import { ClaudeService } from "../services/claude.js";
import { ThreadStateService } from "../services/thread-state.js";
import { getAssessment } from "../data/assessment.js";

export interface SlackMessageEvent {
  type: "message";
  subtype?: string;
  thread_ts?: string;
  text: string;
  user: string;
  bot_id?: string;
  channel: string;
  ts: string;
}

export class SlackMessageHandler {
  constructor(
    private slackService: SlackService,
    private claudeService: ClaudeService,
    private threadStateService: ThreadStateService,
    private botUserId: string
  ) {}

  /**
   * Slack メッセージイベントを処理
   */
  async handleMessage(event: SlackMessageEvent): Promise<void> {
    // Bot 自身のメッセージは無視
    if (event.bot_id || event.user === this.botUserId) {
      console.log("Ignoring bot message");
      return;
    }

    // スレッド返信でない場合は無視
    if (!event.thread_ts) {
      console.log("Ignoring non-thread message");
      return;
    }

    // message_changed などのサブタイプは無視
    if (event.subtype) {
      console.log(`Ignoring message with subtype: ${event.subtype}`);
      return;
    }

    const threadTs = event.thread_ts;

    // スレッド状態が存在しない場合は無視（Issue 回答ドラフトのスレッドではない）
    if (!this.threadStateService.hasThreadState(threadTs)) {
      console.log(`Thread ${threadTs} is not an issue draft thread`);
      return;
    }

    console.log(`Processing thread comment: ${event.text}`);

    try {
      await this.processThreadComment(threadTs, event.text, event.channel);
    } catch (error) {
      console.error("Error processing thread comment:", error);

      // エラーメッセージをスレッドに投稿
      await this.slackService.replyToThread({
        channel: event.channel,
        threadTs,
        text: `❌ エラーが発生しました: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  /**
   * スレッドコメントを処理して回答を更新
   */
  private async processThreadComment(
    threadTs: string,
    comment: string,
    channel: string
  ): Promise<void> {
    const state = this.threadStateService.getThreadState(threadTs);
    if (!state) {
      throw new Error("Thread state not found");
    }

    // コメントを会話履歴に追加
    this.threadStateService.addConversationHistory(threadTs, "user", comment);

    // Claude で更新された回答を生成
    console.log("Generating updated answer with Claude...");
    const updatedAnswer = await this.generateUpdatedAnswer(state, comment);

    // 更新された回答を会話履歴に追加
    this.threadStateService.addConversationHistory(
      threadTs,
      "assistant",
      updatedAnswer
    );
    this.threadStateService.updateLastDraftAnswer(threadTs, updatedAnswer);

    // スレッドに更新された回答を投稿
    await this.slackService.replyToThread({
      channel,
      threadTs,
      text: `✨ 回答を更新しました:\n\n${updatedAnswer}`,
    });

    console.log(`Successfully updated answer for thread ${threadTs}`);
  }

  /**
   * Claude で更新された回答を生成
   */
  private async generateUpdatedAnswer(
    state: ThreadState,
    comment: string
  ): Promise<string> {
    const assessment = getAssessment();

    // システムプロンプト構築
    const systemPrompt = this.buildSystemPrompt(assessment);

    // 会話履歴を構築
    const messages = this.buildMessages(state, comment);

    const response = await this.claudeService.generateWithHistory({
      systemPrompt,
      messages,
    });

    return response;
  }

  /**
   * システムプロンプトを構築
   */
  private buildSystemPrompt(assessment: any): string {
    const techStackList = assessment.techStack.join(", ");
    const codingRules = assessment.codingStandards
      .map(
        (std: any) =>
          `${std.language}:\n${std.rules.map((r: string) => `  - ${r}`).join("\n")}`
      )
      .join("\n\n");

    return `あなたは ${assessment.projectName} のテクニカルサポートアシスタントです。

# プロジェクト概要
${assessment.description}

# 技術スタック
${techStackList}

# アーキテクチャ
パターン: ${assessment.architecture.pattern}
${assessment.architecture.description}

# コーディング規約
${codingRules}

# あなたの役割
GitHub Issue で寄せられた質問やバグレポートに対して、プロジェクトの知識とコンテキストに基づいた的確な回答ドラフトを作成してください。

KOS コンサルタントからのフィードバックを受けて、回答を改善・修正してください。

回答は以下の点を意識してください：
- 明確で具体的な説明
- コード例を含める（必要に応じて）
- プロジェクトのコーディング規約に準拠
- 関連するドキュメントや参考情報へのリンク（もしあれば）
- 丁寧でフレンドリーなトーン`;
  }

  /**
   * メッセージ履歴を構築
   */
  private buildMessages(
    state: ThreadState,
    comment: string
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // 最初のユーザーメッセージ（Issue の内容）
    messages.push({
      role: "user",
      content: `以下の GitHub Issue に対する回答ドラフトを作成してください。

# Issue タイトル
${state.issueTitle}

# Issue 本文
${state.originalQuestion}

# Issue URL
${state.issueUrl}

上記の情報に基づいて、Issue 作成者に対する回答ドラフトを Markdown 形式で作成してください。`,
    });

    // 最初の回答
    messages.push({
      role: "assistant",
      content: state.lastDraftAnswer,
    });

    // 会話履歴を追加（最初の Issue と回答は除く）
    for (const msg of state.conversationHistory) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    // 現在のコメント
    messages.push({
      role: "user",
      content: `上記の回答ドラフトに対するフィードバックです:\n\n${comment}\n\nフィードバックを反映して、回答を改善してください。改善した回答のみを Markdown 形式で返してください。`,
    });

    return messages;
  }
}

// TypeScript の型インポート用
import type { ThreadState } from "../services/thread-state.js";
