import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { listObjects, R2_STORAGE_LIMIT_BYTES } from "../../../../lib/r2-storage";

export const runtime = "nodejs";

// A listagem do bucket é cara: guarda o resultado por alguns minutos.
let cached: { at: number; usedBytes: number; objects: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!cached || refresh || Date.now() - cached.at > CACHE_MS) {
    try {
      const listed = await listObjects();
      if (!listed) return NextResponse.json({ error: "Armazenamento R2 não configurado." }, { status: 503 });
      cached = { at: Date.now(), usedBytes: listed.bytes, objects: listed.keys.length };
    } catch (error) {
      console.warn("R2 usage lookup failed:", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Não foi possível consultar o armazenamento." }, { status: 502 });
    }
  }
  return NextResponse.json({
    usedBytes: cached.usedBytes,
    limitBytes: R2_STORAGE_LIMIT_BYTES,
    objects: cached.objects,
    checkedAt: new Date(cached.at).toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
