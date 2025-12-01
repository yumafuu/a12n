import { Request, Response, Router } from "express";
import { Octokit } from "@octokit/rest";
import { SlackService } from "../services/slack.js";
import { ClaudeService } from "../services/claude.js";
import { ThreadStateService } from "../services/thread-state.js";
import { getAssessment } from "../data/assessment.js";

export function createGitHubRouter(params: {
  octokit: Octokit;
  slackService: SlackService;
  claudeService: ClaudeService;
  threadStateService?: ThreadStateService;
}): Router {
  const { octokit, slackService, claudeService, threadStateService } = params;
  const router = Router();

  /**
   * GitHub Webhook エンドポイント
   * Issue の作成イベントを受け取る
   */
  router.post("/webhook/github", async (req: Request, res: Response) => {
    try {
      const event = req.headers["x-github-event"] as string;

      // Ping イベント（webhook 登録時）
      if (event === "ping") {
        return res.json({ message: "pong" });
      }

      // Issue イベントのみ処理
      if (event !== "issues") {
        return res.status(200).json({ message: "Event ignored" });
      }

      const payload = req.body;
      const action = payload.action;

      // Issue が開かれた時のみ処理
      if (action !== "opened") {
        return res.status(200).json({ message: "Action ignored" });
      }

      const issue = payload.issue;
      const repository = payload.repository;

      // バックグラウンドで処理を実行
      handleIssueOpened({
        octokit,
        slackService,
        claudeService,
        threadStateService,
        issue,
        repository,
      }).catch((error) => {
        console.error("Error handling issue:", error);
      });

      // 即座にレスポンスを返す
      res.status(200).json({ message: "Issue received" });
    } catch (error) {
      console.error("Error in GitHub webhook:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

/**
 * Issue が開かれた時の処理
 */
async function handleIssueOpened(params: {
  octokit: Octokit;
  slackService: SlackService;
  claudeService: ClaudeService;
  threadStateService?: ThreadStateService;
  issue: any;
  repository: any;
}): Promise<void> {
  const {
    octokit,
    slackService,
    claudeService,
    threadStateService,
    issue,
    repository,
  } = params;

  const issueUrl = issue.html_url;
  const issueTitle = issue.title;
  const issueBody = issue.body || "（本文なし）";

  console.log(`Processing issue: ${issueTitle}`);

  // 1. リポジトリのコードコンテキストを取得
  const codeContext = await fetchCodeContext({
    octokit,
    owner: repository.owner.login,
    repo: repository.name,
  });

  // 2. アセスメントデータを取得
  const assessment = getAssessment();

  // 3. Claude で回答ドラフトを生成
  console.log("Generating draft answer with Claude...");
  const draftAnswer = await claudeService.generateIssueDraft({
    issueTitle,
    issueBody,
    codeContext,
    assessment,
  });

  // 4. Slack に投稿
  console.log("Posting to Slack...");
  const slackMessage = await slackService.postIssueDraft({
    issueUrl,
    issueTitle,
    issueBody,
    draftAnswer,
  });

  // 5. スレッド状態を保存（Phase 3）
  if (threadStateService && slackMessage.ts) {
    threadStateService.saveThreadState(slackMessage.ts, {
      issueNumber: issue.number,
      repoOwner: repository.owner.login,
      repoName: repository.name,
      issueUrl,
      issueTitle,
      originalQuestion: issueBody,
      conversationHistory: [],
      lastDraftAnswer: draftAnswer,
    });
    console.log(`Thread state saved for ts: ${slackMessage.ts}`);
  }

  console.log(`Successfully processed issue: ${issueTitle}`);
}

/**
 * リポジトリのコードコンテキストを取得
 * 主要なファイルを取得して、Claude に渡すコンテキストを作成
 */
async function fetchCodeContext(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<string> {
  const { octokit, owner, repo } = params;

  try {
    // README を取得
    const readmeContent = await fetchFileContent({
      octokit,
      owner,
      repo,
      path: "README.md",
    });

    // specification.md を取得（もしあれば）
    const specContent = await fetchFileContent({
      octokit,
      owner,
      repo,
      path: "specification.md",
    });

    // package.json を取得（もしあれば）
    const packageJsonContent = await fetchFileContent({
      octokit,
      owner,
      repo,
      path: "package.json",
    });

    const context = `
# README.md
${readmeContent || "（ファイルなし）"}

# specification.md
${specContent || "（ファイルなし）"}

# package.json
${packageJsonContent || "（ファイルなし）"}
    `.trim();

    return context;
  } catch (error) {
    console.error("Error fetching code context:", error);
    return "（コードコンテキストの取得に失敗しました）";
  }
}

/**
 * ファイルの内容を取得
 */
async function fetchFileContent(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  path: string;
}): Promise<string | null> {
  const { octokit, owner, repo, path } = params;

  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });

    if (!("content" in response.data)) {
      return null;
    }

    const content = Buffer.from(response.data.content, "base64").toString(
      "utf-8"
    );
    return content;
  } catch (error) {
    // ファイルが存在しない場合は null を返す
    return null;
  }
}
