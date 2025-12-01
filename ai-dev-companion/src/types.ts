/**
 * Environment variables / secrets
 */
export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  // Optional: Slack channel ID for posting issue responses
  SLACK_CHANNEL_ID?: string;
}

/**
 * GitHub to Slack user mapping
 */
export interface UserMapping {
  slack_user_id: string;
  github_username: string;
}

/**
 * Mock KOS Assessment Data
 */
export interface KOSAssessmentData {
  project_name: string;
  overview: string;
  tech_stack: string[];
  common_issues: string[];
}
