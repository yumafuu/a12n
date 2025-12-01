/**
 * Verify GitHub webhook signature using Web Crypto API
 * @param payload - Request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param secret - GitHub webhook secret
 */
export async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  const encoder = new TextEncoder();

  // Import secret as cryptographic key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign the payload
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );

  // Convert to hex string
  const expectedSignature =
    'sha256=' +
    Array.from(new Uint8Array(signed))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

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
