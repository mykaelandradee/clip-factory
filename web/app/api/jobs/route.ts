import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

const jobs = new Map<string, { status: string; createdAt: string; request: unknown }>();

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

  const jobId = randomUUID();
  jobs.set(jobId, { status: "queued", createdAt: new Date().toISOString(), request: body });
  return NextResponse.json({ jobId, status: "queued" });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });
  const job = jobs.get(id);
  if (!job) return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  return NextResponse.json({ jobId: id, ...job });
}
