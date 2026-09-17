import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const workerUrl = process.env.CLIP_FACTORY_WORKER_URL;
  if (!workerUrl) return NextResponse.json({ error: "Worker não configurado" }, { status: 503 });

  const { path } = await params;
  const relative = path.map((part) => encodeURIComponent(part)).join("/");
  const headers = new Headers();
  if (process.env.CLIP_FACTORY_WORKER_TOKEN) {
    headers.set("Authorization", `Bearer ${process.env.CLIP_FACTORY_WORKER_TOKEN}`);
  }

  try {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/files/${relative}`, { headers, cache: "no-store" });
    if (!response.ok) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: response.status });

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        "Content-Length": response.headers.get("content-length") ?? "",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Worker indisponível" }, { status: 502 });
  }
}
