import { NextResponse } from "next/server";

export const runtime = "nodejs";

function workerConfig() {
  const url = process.env.CLIP_FACTORY_WORKER_URL;
  if (!url) throw new Error("CLIP_FACTORY_WORKER_URL não configurada");
  return {
    url: url.replace(/\/$/, ""),
    token: process.env.CLIP_FACTORY_WORKER_TOKEN,
  };
}

async function workerFetch(path: string, init: RequestInit = {}) {
  const { url, token } = workerConfig();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${url}${path}`, { ...init, headers, cache: "no-store" });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "URL do YouTube é obrigatória" }, { status: 400 });
  }

  try {
    const parsed = new URL(body.url);
    if (!parsed.hostname.includes("youtube.com") && !parsed.hostname.includes("youtu.be")) {
      return NextResponse.json({ error: "Informe uma URL válida do YouTube" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  try {
    const response = await workerFetch("/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: body.url,
        provider: body.provider ?? "openai",
        count: Number(body.count ?? 5),
        min_duration: Number(body.min_duration ?? 20),
        max_duration: Number(body.max_duration ?? 60),
      }),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Worker indisponível" },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  try {
    const response = await workerFetch(`/jobs/${encodeURIComponent(id)}`);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Worker indisponível" },
      { status: 502 },
    );
  }
}
