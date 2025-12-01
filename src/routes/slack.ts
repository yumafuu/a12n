import { Request, Response, Router } from "express";
import { verifySlackSignature } from "../utils/slack-verify.js";
import { Octokit } from "@octokit/rest";

export function createSlackRouter(params: {
  slackSigningSecret: string;
  octokit: Octokit;
}): Router {
  const { slackSigningSecret, octokit } = params;
  const router = Router();

  /**
   * Slack Webhook エンドポイント
   * インタラクティブメッセージ（ボタンクリックなど）を受け取る
   */
  router.post("/webhook/slack", async (req: Request, res: Response) => {
    try {
      // リクエストボディを文字列として取得（署名検証のため）
      const requestBody = JSON.stringify(req.body);
      const signature = req.headers["x-slack-signature"] as string;
      const timestamp = req.headers["x-slack-request-timestamp"] as string;

      // 署名を検証
      if (!signature || !timestamp) {
        return res.status(401).json({ error: "Missing signature headers" });
      }

      const isValid = verifySlackSignature({
        signingSecret: slackSigningSecret,
        requestSignature: signature,
        requestTimestamp: timestamp,
        requestBody,
      });

      if (!isValid) {
        console.warn("Invalid Slack signature");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const payload = req.body;

      // URL verification イベント（Slack アプリ設定時）
      if (payload.type === "url_verification") {
        return res.json({ challenge: payload.challenge });
      }

      // インタラクティブメッセージの処理
      if (payload.type === "block_actions") {
        // バックグラウンドで処理
        handleBlockAction(payload, octokit).catch((error) => {
          console.error("Error handling block action:", error);
        });

        // 即座にレスポンスを返す（3秒以内に返す必要がある）
        return res.status(200).json({ ok: true });
      }

      // その他のイベントは無視
      res.status(200).json({ message: "Event ignored" });
    } catch (error) {
      console.error("Error in Slack webhook:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

/**
 * Block Action（ボタンクリックなど）の処理
 */
async function handleBlockAction(
  payload: any,
  octokit: Octokit
): Promise<void> {
  const actions = payload.actions;
  if (!actions || actions.length === 0) {
    return;
  }

  const action = actions[0];
  const actionId = action.action_id;
  const issueUrl = action.value;

  console.log(`Handling action: ${actionId} for ${issueUrl}`);

  switch (actionId) {
    case "approve_draft":
      await handleApproveDraft(issueUrl, octokit, payload);
      break;
    case "edit_draft":
      await handleEditDraft(issueUrl, payload);
      break;
    case "reject_draft":
      await handleRejectDraft(issueUrl, payload);
      break;
    default:
      console.warn(`Unknown action: ${actionId}`);
  }
}

/**
 * 承認して投稿
 */
async function handleApproveDraft(
  issueUrl: string,
  octokit: Octokit,
  payload: any
): Promise<void> {
  console.log(`Approving draft for ${issueUrl}`);

  // Issue URL から owner, repo, issue_number を抽出
  const match = issueUrl.match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/
  );
  if (!match) {
    console.error(`Invalid issue URL: ${issueUrl}`);
    return;
  }

  const [, owner, repo, issueNumberStr] = match;
  const issueNumber = parseInt(issueNumberStr, 10);

  // Slack メッセージから回答ドラフトを抽出
  const blocks = payload.message.blocks;
  const draftBlock = blocks.find(
    (block: any) =>
      block.type === "section" &&
      block.text?.text?.includes("*AI生成回答ドラフト:*")
  );

  if (!draftBlock) {
    console.error("Draft answer not found in message");
    return;
  }

  const draftText = draftBlock.text.text;
  const answerMatch = draftText.match(/\*AI生成回答ドラフト:\*\n(.+)/s);
  if (!answerMatch) {
    console.error("Failed to extract draft answer");
    return;
  }

  const answer = answerMatch[1].trim();

  // GitHub Issue にコメント投稿
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: answer,
    });

    console.log(`Posted comment to issue #${issueNumber}`);
  } catch (error) {
    console.error("Failed to post comment:", error);
  }
}

/**
 * 編集する
 */
async function handleEditDraft(issueUrl: string, payload: any): Promise<void> {
  console.log(`Editing draft for ${issueUrl}`);
  // TODO: モーダルを開いて編集可能にする実装
  // ここでは簡単にログ出力のみ
}

/**
 * 却下
 */
async function handleRejectDraft(issueUrl: string, payload: any): Promise<void> {
  console.log(`Rejecting draft for ${issueUrl}`);
  // TODO: 却下した旨をスレッドに投稿する実装
}
