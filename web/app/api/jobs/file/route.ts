import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getR2PublicClipUrl } from "../../../../lib/r2";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const GENERATION_ONLY_MODE = process.env.CLIP_FACTORY_GENERATION_ONLY === "true";
function isValidAnonymousAccessToken(jobId: string, token: string | null) {
  const secret = process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY || process.env.CLIP_FACTORY_WORKER_TOKEN || "";
  if (!secret || !token) return false;
  const expected = createHmac("sha256", secret).update(`clip-factory-anonymous-job:${jobId}`).digest("base64url");
  const a = Buffer.from(expected); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  let user = null;

  if (!GENERATION_ONLY_MODE) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const file = params.get("file");
  const accessToken = params.get("accessToken");

  if (!id || !file || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !/^clip-(?:0[1-9]|1[0-5])\.mp4$/i.test(file)) {
    return Response.json({ error: "Clip inválido." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const jobQuery = admin.from("clip_jobs").select("id").eq("id", id);
    const { data: ownedJob } = user
      ? await jobQuery.eq("user_id", user.id).maybeSingle()
      : isValidAnonymousAccessToken(id, accessToken) ? await jobQuery.is("user_id", null).maybeSingle() : { data: null };

    if (!ownedJob) {
      return Response.json({ error: "Processamento não encontrado." }, { status: 404 });
    }

    const target = getR2PublicClipUrl(id, file);
    return Response.redirect(target, 302);
  } catch (error) {
    console.error("R2 clip redirect error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Erro ao obter o clip." },
      { status: 502 },
    );
  }
}
