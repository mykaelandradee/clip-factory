import { createHmac } from "node:crypto";
import { getAnonymousJobSecret, safeEqual } from "./security";

export function createAnonymousAccessToken(jobId: string, secret: string = getAnonymousJobSecret()) {
  if (!secret) throw new Error("Proteção de jobs anônimos não está configurada.");
  return createHmac("sha256", secret)
    .update(`clip-factory-anonymous-job:${jobId}`)
    .digest("base64url");
}

export function isValidAnonymousAccessToken(jobId: string, token: string | null, secret: string = getAnonymousJobSecret()) {
  if (!token || !secret) return false;
  try {
    return safeEqual(token, createAnonymousAccessToken(jobId, secret));
  } catch {
    return false;
  }
}
