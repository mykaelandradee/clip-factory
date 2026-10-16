import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

/** Marca que o OAuth do YouTube foi iniciado por um perfil do Influencer Manager. */
export const INFLUENCER_YOUTUBE_PROFILE_COOKIE = "cf_influencer_youtube_profile";

export const YOUTUBE_SCOPES =
  "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl";

/** Erro do YouTube com classificação para decidir entre reconectar, tentar depois ou falhar. */
export class YouTubeError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "quota" | "retryable" | "fatal",
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

function classify(status: number, reason: string, message: string): YouTubeError {
  const r = reason.toLowerCase();
  if (status === 401 || r === "invalid_grant" || r === "autherror" || r === "unauthorized_client") {
    return new YouTubeError("A autorização do YouTube expirou ou foi revogada. Reconecte o canal deste perfil.", "auth");
  }
  if (r === "quotaexceeded" || r === "dailylimitexceeded" || r === "uploadlimitexceeded" || r === "ratelimitexceeded" || r === "userratelimitexceeded") {
    return new YouTubeError(
      r === "uploadlimitexceeded"
        ? "O canal atingiu o limite diário de uploads do YouTube. Nova tentativa mais tarde."
        : "A cota diária da API do YouTube foi atingida. Nova tentativa mais tarde.",
      "quota",
    );
  }
  if (r === "youtubesignuprequired") {
    return new YouTubeError("A conta Google conectada não tem um canal do YouTube.", "auth");
  }
  if (status >= 500 || status === 429) return new YouTubeError(message || "O YouTube está indisponível no momento.", "retryable");
  return new YouTubeError(message || "O YouTube recusou o envio do vídeo.", "fatal");
}

async function readError(response: Response) {
  const data = await response.json().catch(() => ({} as any));
  const reason = String(data?.error?.errors?.[0]?.reason || data?.error || "");
  const message = String(data?.error?.message || data?.error_description || "");
  return classify(response.status, reason, message);
}

export async function getYouTubeAccessToken(refreshToken: string) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new YouTubeError("A integração do YouTube não está configurada.", "fatal");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  if (!data?.access_token) throw new YouTubeError("O Google não retornou um token de acesso.", "retryable");
  return String(data.access_token);
}

export async function getMyChannel(accessToken: string) {
  const response = await fetch(`${API}/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  const channel = data?.items?.[0];
  if (!channel?.id) throw new YouTubeError("A conta Google conectada não tem um canal do YouTube.", "auth");
  return {
    id: String(channel.id),
    title: channel.snippet?.title ? String(channel.snippet.title) : null,
    handle: channel.snippet?.customUrl ? String(channel.snippet.customUrl) : null,
  };
}

export async function revokeGoogleToken(token: string) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      cache: "no-store",
    });
  } catch {
    // Revogação é cortesia: a conexão local já foi removida.
  }
}

/** O YouTube rejeita "<" e ">" e limita o título a 100 caracteres. */
export function buildShortTitle(raw: string) {
  const clean = raw.replace(/[<>]/g, "").replace(/\s+/g, " ").trim() || "Novo vídeo";
  const suffix = " #Shorts";
  const limit = 100 - suffix.length;
  const base = clean.length > limit ? clean.slice(0, limit - 1).trimEnd() + "…" : clean;
  return /#shorts/i.test(base) ? base : base + suffix;
}

export function buildShortDescription(raw: string) {
  const clean = raw.replace(/[<>]/g, "").trim();
  // Limite de 5.000 bytes; corta por caracteres com folga para acentos.
  return clean.length > 4500 ? clean.slice(0, 4500) : clean;
}

/**
 * Envia um corpo em streaming com Content-Length explícito (exigido pelo upload
 * resumable do Google) sem carregar o vídeo inteiro na memória.
 */
function putStream(target: string, headers: Record<string, string>, body: Readable): Promise<{ status: number; text: string }> {
  const url = new URL(target);
  const client = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(url, { method: "PUT", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(240_000, () => request.destroy(new Error("O envio ao YouTube excedeu o tempo limite.")));
    request.on("error", reject);
    body.on("error", (error) => request.destroy(error));
    body.pipe(request);
  });
}

export async function uploadShort(params: { accessToken: string; videoUrl: string; title: string; description: string; uploadUrl?: string }) {
  // 1. Tamanho do vídeo, sem baixá-lo.
  const head = await fetch(params.videoUrl, { method: "HEAD", cache: "no-store" });
  if (!head.ok) throw new YouTubeError("O vídeo não está acessível no R2.", "retryable");
  const size = Number(head.headers.get("content-length") || 0);
  if (!size) throw new YouTubeError("O R2 não informou o tamanho do vídeo.", "retryable");
  if (size > MAX_VIDEO_BYTES) throw new YouTubeError("O vídeo é grande demais para envio automático.", "fatal");

  // 2. Abre a sessão de upload no YouTube.
  const session = await fetch(params.uploadUrl || UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: { title: params.title, description: params.description, categoryId: "22" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    }),
    cache: "no-store",
  });
  if (!session.ok) throw await readError(session);
  const location = session.headers.get("location");
  if (!location) throw new YouTubeError("O YouTube não iniciou a sessão de upload.", "retryable");

  // 3. Transmite o vídeo do R2 direto para o YouTube, em pedaços.
  const media = await fetch(params.videoUrl, { cache: "no-store" });
  if (!media.ok || !media.body) throw new YouTubeError("O vídeo não está acessível no R2.", "retryable");
  const result = await putStream(location, {
    Authorization: `Bearer ${params.accessToken}`,
    "Content-Type": "video/mp4",
    "Content-Length": String(size),
  }, Readable.fromWeb(media.body as unknown as NodeReadableStream));

  let data: any = {};
  try { data = JSON.parse(result.text); } catch { /* resposta não JSON */ }
  if (result.status < 200 || result.status >= 300) {
    const reason = String(data?.error?.errors?.[0]?.reason || data?.error || "");
    throw classify(result.status, reason, String(data?.error?.message || ""));
  }
  if (!data?.id) throw new YouTubeError("O YouTube não confirmou o envio do vídeo.", "retryable");
  return { videoId: String(data.id), privacyStatus: String(data?.status?.privacyStatus || "") };
}

export type YouTubeVideoStats = { views: number | null; likes: number | null; comments: number | null };

/**
 * Estatísticas públicas dos vídeos (visualizações, curtidas, comentários).
 * Consulta em lotes de 50 IDs — cada lote custa 1 unidade da cota da API.
 * Curtidas podem vir ocultas pelo dono do canal; nesse caso o valor é null.
 */
export async function getVideoStatistics(accessToken: string, videoIds: string[]) {
  const stats = new Map<string, YouTubeVideoStats>();
  const unique = [...new Set(videoIds.filter((id) => /^[A-Za-z0-9_-]{6,20}$/.test(id)))];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const response = await fetch(`${API}/videos?part=statistics&id=${batch.map(encodeURIComponent).join(",")}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) throw await readError(response);
    const data = await response.json();
    for (const video of data?.items || []) {
      const s = video?.statistics || {};
      const num = (value: unknown) => (value === undefined || value === null || Number.isNaN(Number(value)) ? null : Number(value));
      stats.set(String(video.id), { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) });
    }
  }
  return stats;
}
