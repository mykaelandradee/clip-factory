import crypto from "node:crypto";

const COOKIE_NAME = "cf_youtube_connection";
const STATE_COOKIE = "cf_youtube_oauth_state";

function key() {
  const raw = process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("CLIP_FACTORY_TOKEN_ENCRYPTION_KEY is not configured.");
  return crypto.createHash("sha256").update(raw).digest();
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input: string) {
  return Buffer.from(input, "base64url");
}

export function encryptYouTubeRefreshToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [b64url(iv), b64url(tag), b64url(ciphertext)].join(".");
}

export function decryptYouTubeRefreshToken(value: string) {
  const [ivPart, tagPart, dataPart] = value.split(".");
  if (!ivPart || !tagPart || !dataPart) return null;

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), fromB64url(ivPart));
    decipher.setAuthTag(fromB64url(tagPart));
    return Buffer.concat([
      decipher.update(fromB64url(dataPart)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function createOAuthState() {
  return crypto.randomBytes(32).toString("hex");
}

export function getYouTubeCookieName() {
  return COOKIE_NAME;
}

export function getOAuthStateCookieName() {
  return STATE_COOKIE;
}
