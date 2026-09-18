import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "URL obrigatória" }, { status: 400 });

  try {
    const parsed = new URL(url);
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(parsed.hostname)) {
      return NextResponse.json({ error: "URL do YouTube inválida" }, { status: 400 });
    }

    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { cache: "no-store" },
    );
    if (!response.ok) return NextResponse.json({ error: "Não foi possível obter os dados do vídeo." }, { status: 502 });

    const data = await response.json();
    return NextResponse.json({
      title: data.title ?? "Vídeo do YouTube",
      author: data.author_name ?? "",
      thumbnail: data.thumbnail_url ?? "",
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível ler a URL." }, { status: 400 });
  }
}
