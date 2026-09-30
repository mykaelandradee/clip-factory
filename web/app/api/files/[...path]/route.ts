import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "Endpoint de arquivos legado desativado." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
