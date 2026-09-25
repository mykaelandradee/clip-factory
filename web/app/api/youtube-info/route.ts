import { NextResponse } from "next/server";
import { getClientKey, rateLimit } from "../../../lib/rate-limit";

export const runtime = "nodejs";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const MAX_URL_LENGTH = 2048;

export async function GET(request: Request) {
  const limit = rateLimit(getClientKey(request), 30, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Muitas consultas de vídeo. Aguarde alguns segundos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const rawUrl = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "URL inválida." }, { status: 400 });
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || !YOUTUBE_HOSTS.has(parsed.hostname)) {
      return NextResponse.json({ error: "URL do YouTube inválida." }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) {
        return NextResponse.json({ error: "Não foi possível obter os dados do vídeo." }, { status: 502 });
      }

      const data = await response.json();
      return NextResponse.json({
        title: typeof data?.title === "string" ? data.title.slice(0, 300) : "Vídeo do YouTube",
        author: typeof data?.author_name === "string" ? data.author_name.slice(0, 150) : "",
        thumbnail: typeof data?.thumbnail_url === "string" ? data.thumbnail_url.slice(0, 2048) : "",
      }, { headers: { "Cache-Control": "no-store" } });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return NextResponse.json({ error: "Não foi possível ler a URL do YouTube." }, { status: 400 });
  }
}
