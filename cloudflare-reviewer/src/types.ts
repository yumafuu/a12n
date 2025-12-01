// Environment variables for Cloudflare Workers
export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}

// GitHub Webhook payload types
export interface GitHubWebhookPayload {
  action: string;
  pull_request?: {
    number: number;
    title: string;
    html_url: string;
    head: {
      sha: string;
      ref: string;
      repo: {
        full_name: string;
      };
    };
    base: {
      sha: string;
      ref: string;
      repo: {
        full_name: string;
      };
    };
  };
  repository?: {
    full_name: string;
    owner: {
      login: string;
    };
    name: string;
  };
}

// Review criteria from KOS assessment system
export interface ReviewCriteria {
  category: string;
  items: ReviewItem[];
}

export interface ReviewItem {
  id: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}
