import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  return NextResponse.json({
    status: token ? "online" : "offline",
    backend: "github-actions",
  }, { status: token ? 200 : 503 });
}
