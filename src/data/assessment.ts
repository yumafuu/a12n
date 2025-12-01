/**
 * KOSアセスメントシステム仮データ
 * 後で本物のアセスメントシステムと統合可能な構造
 */

export interface ProjectAssessment {
  projectName: string;
  description: string;
  techStack: string[];
  architecture: {
    pattern: string;
    description: string;
  };
  codingStandards: {
    language: string;
    rules: string[];
  }[];
  commonPatterns: {
    category: string;
    examples: string[];
  }[];
  troubleshooting: {
    issue: string;
    solution: string;
  }[];
}

/**
 * 仮のアセスメントデータ
 * 実際の運用では外部APIや設定ファイルから取得する
 */
export const mockAssessment: ProjectAssessment = {
  projectName: "AI Orchestration MCP",
  description:
    "Claude CLI を自律型エージェントとして動作させるための MCP (Model Context Protocol) 実装。tmux を UI として使用し、planner / orchestrator / worker の 3 つのロールで協調動作する。",
  techStack: [
    "Bun (TypeScript)",
    "SQLite (bun:sqlite)",
    "tmux",
    "Claude CLI",
    "git worktree",
    "GitHub PR",
  ],
  architecture: {
    pattern: "Multi-Agent Orchestration",
    description:
      "Planner が要件を明確化し、Orchestrator が Worker を管理。Worker は独立した worktree で並列作業を行い、PR を通じて成果物を提出する。",
  },
  codingStandards: [
    {
      language: "TypeScript",
      rules: [
        "厳格な型定義を使用 (strict mode)",
        "async/await を優先、Promise チェーンは最小限に",
        "エラーハンドリングは必須",
        "関数は単一責任の原則に従う",
        "ファイル名は kebab-case を使用",
      ],
    },
    {
      language: "SQL",
      rules: [
        "トランザクションを適切に使用",
        "インデックスを効果的に活用",
        "プリペアドステートメントでSQLインジェクション対策",
      ],
    },
  ],
  commonPatterns: [
    {
      category: "メッセージング",
      examples: [
        "SQLite を使った非同期メッセージング",
        "Watcher による変更通知",
        "Heartbeat による生存監視",
      ],
    },
    {
      category: "並列処理",
      examples: [
        "git worktree による独立作業環境",
        "tmux pane による UI 分割",
        "Worker の同時実行",
      ],
    },
    {
      category: "MCP ツール実装",
      examples: [
        "ロールごとの専用ツールセット",
        "Zod によるスキーマ検証",
        "CallToolRequest ハンドラーパターン",
      ],
    },
  ],
  troubleshooting: [
    {
      issue: "Worker が応答しない",
      solution:
        "Heartbeat タイムアウト (30秒) を確認。check_messages を定期的に呼び出しているか確認。",
    },
    {
      issue: "worktree が残っている",
      solution: "git worktree remove --force .worktrees/worker-xxx で削除",
    },
    {
      issue: "SQLite ロックエラー",
      solution: "トランザクション範囲を最小化。PRAGMA busy_timeout を設定。",
    },
    {
      issue: "tmux pane が見つからない",
      solution: "tmux list-panes で確認。セッション名とペイン番号が正しいか確認。",
    },
  ],
};

/**
 * アセスメントデータを取得
 * 将来的には引数でプロジェクトIDなどを受け取り、外部から取得する
 */
export function getAssessment(projectId?: string): ProjectAssessment {
  // 将来的にはここで外部APIを呼び出すなど
  return mockAssessment;
}
