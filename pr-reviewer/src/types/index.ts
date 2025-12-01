export interface GitHubWebhookPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head: {
      sha: string;
      ref: string;
    };
    base: {
      sha: string;
      ref: string;
    };
    diff_url: string;
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
    full_name: string;
  };
}

export interface PRDiff {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface ClaudeReviewResponse {
  summary: string;
  comments: ReviewComment[];
  overallAssessment: string;
}
