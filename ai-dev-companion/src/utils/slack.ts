import { createHmac } from 'crypto';

/**
 * Verify Slack request signature
 * @param signingSecret - Slack signing secret
 * @param requestSignature - X-Slack-Signature header
 * @param timestamp - X-Slack-Request-Timestamp header
 * @param body - Request body as string
 */
export function verifySlackSignature(
  signingSecret: string,
  requestSignature: string | null,
  timestamp: string | null,
  body: string
): boolean {
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
  const hmac = createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const mySignature = `v0=${hmac.digest('hex')}`;

  return mySignature === requestSignature;
}
