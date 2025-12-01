import crypto from "crypto";

/**
 * Slack リクエストの署名を検証
 * セキュリティのため、必ず実装すること
 *
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(params: {
  signingSecret: string;
  requestSignature: string;
  requestTimestamp: string;
  requestBody: string;
}): boolean {
  const { signingSecret, requestSignature, requestTimestamp, requestBody } =
    params;

  // リプレイ攻撃を防ぐため、タイムスタンプが5分以内かチェック
  const timestamp = parseInt(requestTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 60 * 5) {
    console.warn("Request timestamp is too old");
    return false;
  }

  // 署名ベース文字列を作成
  const sigBaseString = `v0:${requestTimestamp}:${requestBody}`;

  // HMAC SHA256 で署名を生成
  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(sigBaseString);
  const mySignature = `v0=${hmac.digest("hex")}`;

  // タイミング攻撃を防ぐため、crypto.timingSafeEqual を使用
  try {
    const mySignatureBuffer = Buffer.from(mySignature);
    const requestSignatureBuffer = Buffer.from(requestSignature);

    if (mySignatureBuffer.length !== requestSignatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(mySignatureBuffer, requestSignatureBuffer);
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}
