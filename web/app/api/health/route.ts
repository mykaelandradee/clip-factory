import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const workerUrl = process.env.CLIP_FACTORY_WORKER_URL;
  if (!workerUrl) return NextResponse.json({ status: "offline", error: "Worker não configurado" }, { status: 503 });

  try {
    const headers = new Headers();
    if (process.env.CLIP_FACTORY_WORKER_TOKEN) {
      headers.set("Authorization", `Bearer ${process.env.CLIP_FACTORY_WORKER_TOKEN}`);
    }
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/health`, { headers, cache: "no-store" });
    return NextResponse.json({ status: response.ok ? "online" : "offline" }, { status: response.ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ status: "offline" }, { status: 503 });
  }
}
