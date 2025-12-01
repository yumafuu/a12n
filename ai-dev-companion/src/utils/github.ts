import { createHmac } from 'crypto';

/**
 * Verify GitHub webhook signature
 * @param payload - Request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param secret - GitHub webhook secret
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  return signature === expectedSignature;
}

/**
 * Parse repository owner and name from full_name
 * @param fullName - e.g., "octocat/Hello-World"
 */
export function parseRepoFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split('/');
  return { owner, repo };
}
