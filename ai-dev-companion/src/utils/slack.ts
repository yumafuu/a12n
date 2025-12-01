/**
 * Verify Slack request signature using Web Crypto API
 * @param signingSecret - Slack signing secret
 * @param requestSignature - X-Slack-Signature header
 * @param timestamp - X-Slack-Request-Timestamp header
 * @param body - Request body as string
 */
export async function verifySlackSignature(
  signingSecret: string,
  requestSignature: string | null,
  timestamp: string | null,
  body: string
): Promise<boolean> {
  if (!requestSignature || !timestamp) {
    return false;
  }

  // Prevent replay attacks (timestamp should be within 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  const timestampNum = parseInt(timestamp, 10);
  if (Math.abs(currentTime - timestampNum) > 60 * 5) {
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();

  // Import signing secret as cryptographic key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign the base string
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(sigBaseString)
  );

  // Convert to hex string
  const expectedSignature =
    'v0=' +
    Array.from(new Uint8Array(signed))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  return requestSignature === expectedSignature;
}
