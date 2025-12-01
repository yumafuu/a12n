import Anthropic from "@anthropic-ai/sdk";
import { ProjectAssessment } from "../data/assessment.js";

export class ClaudeService {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Issue に対する回答ドラフトを生成
   */
  async generateIssueDraft(params: {
    issueTitle: string;
    issueBody: string;
    codeContext: string;
    assessment: ProjectAssessment;
  }): Promise<string> {
    const { issueTitle, issueBody, codeContext, assessment } = params;

    const systemPrompt = this.buildSystemPrompt(assessment);
    const userPrompt = this.buildUserPrompt({
      issueTitle,
      issueBody,
      codeContext,
    });

    const response = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude API");
    }

    return content.text;
  }

  /**
   * システムプロンプトを構築
   */
  private buildSystemPrompt(assessment: ProjectAssessment): string {
    const techStackList = assessment.techStack.join(", ");
    const codingRules = assessment.codingStandards
      .map(
        (std) =>
          `${std.language}:\n${std.rules.map((r) => `  - ${r}`).join("\n")}`
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

回答は以下の点を意識してください：
- 明確で具体的な説明
- コード例を含める（必要に応じて）
- プロジェクトのコーディング規約に準拠
- 関連するドキュメントや参考情報へのリンク（もしあれば）
- 丁寧でフレンドリーなトーン`;
  }

  /**
   * ユーザープロンプトを構築
   */
  private buildUserPrompt(params: {
    issueTitle: string;
    issueBody: string;
    codeContext: string;
  }): string {
    const { issueTitle, issueBody, codeContext } = params;

    return `以下の GitHub Issue に対する回答ドラフトを作成してください。

# Issue タイトル
${issueTitle}

# Issue 本文
${issueBody}

# 関連するコードコンテキスト
${codeContext}

上記の情報に基づいて、Issue 作成者に対する回答ドラフトを Markdown 形式で作成してください。`;
  }

  /**
   * 会話履歴を使って応答を生成
   */
  async generateWithHistory(params: {
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<string> {
    const { systemPrompt, messages } = params;

    const response = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      system: systemPrompt,
      messages: messages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Claude API");
    }

    return content.text;
  }
}
