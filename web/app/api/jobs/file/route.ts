import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getR2PublicClipUrl } from "../../../../lib/r2";

export const runtime = "nodejs";

const GENERATION_ONLY_MODE = process.env.CLIP_FACTORY_GENERATION_ONLY === "true";

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

  if (!id || !file || !/^clip-\d{2}\.mp4$/i.test(file)) {
    return Response.json({ error: "Clip inválido." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const jobQuery = admin.from("clip_jobs").select("id").eq("id", id);
    const { data: ownedJob } = user
      ? await jobQuery.eq("user_id", user.id).maybeSingle()
      : await jobQuery.is("user_id", null).maybeSingle();

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
