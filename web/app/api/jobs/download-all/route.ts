import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { zipSync } from "fflate";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getR2PublicClipUrl } from "../../../../lib/r2";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_PATTERN = /^clip-(?:0[1-9]|1[0-5])\.mp4$/i;

function getAnonymousJobSecret() {
  return process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY || process.env.CLIP_FACTORY_WORKER_TOKEN || process.env.CLIP_FACTORY_GITHUB_TOKEN || "";
}

function isValidAnonymousAccessToken(jobId: string, token: string | null) {
  const secret = getAnonymousJobSecret();
  if (!secret || !token) return false;
  try {
    const expected = createHmac("sha256", secret).update(`clip-factory-anonymous-job:${jobId}`).digest("base64url");
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(token);
    return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

async function getCurrentUser() {
  if (process.env.CLIP_FACTORY_GENERATION_ONLY === "true") return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const limit = rateLimit(getClientKey(request), 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Muitos downloads em pouco tempo. Aguarde alguns minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  const params = new URL(request.url).searchParams;
  const jobId = params.get("jobId") || "";
  const accessToken = params.get("accessToken");

  if (!JOB_ID_PATTERN.test(jobId)) {
    return NextResponse.json({ error: "Processamento inválido." }, { status: 400 });
  }

  try {
    const user = await getCurrentUser();
    const admin = createAdminClient();
    const query = admin.from("clip_jobs").select("id").eq("id", jobId);
    const anonymousOwned = isValidAnonymousAccessToken(jobId, accessToken);
    const { data: ownedJob } = user
      ? anonymousOwned
        ? await query.is("user_id", null).maybeSingle()
        : await query.eq("user_id", user.id).maybeSingle()
      : anonymousOwned
        ? await query.is("user_id", null).maybeSingle()
        : { data: null };

    if (!ownedJob) {
      return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });
    }

    const files = Array.from({ length: 15 }, (_, index) => `clip-${String(index + 1).padStart(2, "0")}.mp4`);
    const entries: Record<string, Uint8Array> = {};

    for (const file of files) {
      if (!FILE_PATTERN.test(file)) continue;
      const upstream = await fetch(getR2PublicClipUrl(jobId, file), { cache: "no-store" });
      if (upstream.status === 404) continue;
      if (!upstream.ok) {
        return NextResponse.json({ error: "Não foi possível obter todos os clips." }, { status: 502 });
      }
      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength > 0) entries[file] = new Uint8Array(buffer);
    }

    if (Object.keys(entries).length === 0) {
      return NextResponse.json({ error: "Nenhum clip disponível para download." }, { status: 404 });
    }

    const archive = zipSync(entries, { level: 0 });
    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Length", String(archive.byteLength));
    headers.set("Content-Disposition", `attachment; filename="clip-factory-${jobId.slice(0, 8)}.zip"`);
    headers.set("Cache-Control", "private, no-store");

    return new Response(archive, { status: 200, headers });
  } catch (error) {
    console.error("All clips download error:", error);
    return NextResponse.json({ error: "Não foi possível gerar o ZIP dos clips." }, { status: 502 });
  }
}
