import { createHmac, timingSafeEqual } from "node:crypto";

export function createAnonymousAccessToken(jobId: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`clip-factory-anonymous-job:${jobId}`)
    .digest("base64url");
}

export function isValidAnonymousAccessToken(jobId: string, token: string | null, secret: string) {
  if (!token || !secret) return false;
  try {
    const expected = Buffer.from(createAnonymousAccessToken(jobId, secret));
    const provided = Buffer.from(token);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}
