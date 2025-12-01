import type { UserMapping } from '../types';

/**
 * Mock user mapping (Slack User ID <-> GitHub Username)
 * This should be replaced with database or config file in production
 */
export const mockUserMapping: UserMapping[] = [
  {
    slack_user_id: 'U01234ABCDE',
    github_username: 'consultant1',
  },
  {
    slack_user_id: 'U56789FGHIJ',
    github_username: 'consultant2',
  },
];

/**
 * Find GitHub username from Slack user ID
 */
export function findGitHubUsername(slackUserId: string): string | null {
  const mapping = mockUserMapping.find((m) => m.slack_user_id === slackUserId);
  return mapping?.github_username ?? null;
}
