import crypto from "node:crypto";

const STATE_COOKIE = "cf_instagram_oauth_state";
const INSTAGRAM_API_VERSION = "v25.0";
const INSTAGRAM_GRAPH = `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`;

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

export function encryptInstagramAccessToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [b64url(iv), b64url(cipher.getAuthTag()), b64url(ciphertext)].join(".");
}

export function decryptInstagramAccessToken(value: string) {
  const [ivPart, tagPart, dataPart] = value.split(".");
  if (!ivPart || !tagPart || !dataPart) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), fromB64url(ivPart));
    decipher.setAuthTag(fromB64url(tagPart));
    return Buffer.concat([decipher.update(fromB64url(dataPart)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export async function exchangeInstagramShortLivedToken(shortLivedToken: string) {
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientSecret) throw new Error("INSTAGRAM_CLIENT_SECRET não configurado.");

  const url = new URL(`${INSTAGRAM_GRAPH}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url, { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok || !data.access_token) {
    console.error("Instagram long-lived token exchange failed:", data);
    throw new Error("Não foi possível obter o token de longa duração do Instagram. Conecte a conta novamente.");
  }

  return {
    accessToken: String(data.access_token),
    expiresIn: Number(data.expires_in) || 0,
  };
}

export async function refreshInstagramLongLivedToken(accessToken: string) {
  const url = new URL(`${INSTAGRAM_GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok || !data.access_token) {
    console.error("Instagram long-lived token refresh failed:", data);
    throw new Error(
      data?.error?.message
        ? String(data.error.message)
        : "Não foi possível renovar o token do Instagram.",
    );
  }

  return {
    accessToken: String(data.access_token),
    expiresIn: Number(data.expires_in) || 0,
  };
}

export function createInstagramOAuthState() {
  return crypto.randomBytes(32).toString("hex");
}

export function getInstagramOAuthStateCookieName() {
  return STATE_COOKIE;
}
