import { NextResponse } from "next/server";
import { unzipSync } from "fflate";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";

function headers() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado na Vercel");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const file = params.get("file");
  const preview = params.get("preview") === "1";

  if (!id || !file || !/^clip-\d{2}\.mp4$/i.test(file)) {
    return NextResponse.json({ error: "Clip inválido." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const jobQuery = admin.from("clip_jobs").select("id").eq("id", id);
    const { data: ownedJob } = user
      ? await jobQuery.eq("user_id", user.id).maybeSingle()
      : await jobQuery.is("user_id", null).maybeSingle();

    if (!ownedJob) {
      return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });
    }

    const artifactResponse = await fetch(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/artifacts?name=clip-factory-${encodeURIComponent(id)}&per_page=1`,
      { headers: headers(), cache: "no-store" },
    );
    if (!artifactResponse.ok) {
      return NextResponse.json({ error: "Resultado ainda não está disponível." }, { status: 404 });
    }

    const data = await artifactResponse.json();
    const artifact = data.artifacts?.[0];
    if (!artifact?.archive_download_url) {
      return NextResponse.json({ error: "Resultado ainda não está disponível." }, { status: 404 });
    }

    const zipResponse = await fetch(artifact.archive_download_url, {
      headers: headers(),
      cache: "no-store",
    });
    if (!zipResponse.ok) {
      return NextResponse.json({ error: "Não foi possível acessar o resultado." }, { status: 502 });
    }

    const zip = unzipSync(new Uint8Array(await zipResponse.arrayBuffer()));
    const entry = Object.entries(zip).find(([path]) =>
      path.split("/").pop()?.toLowerCase() === file.toLowerCase()
    )?.[1];

    if (!entry) {
      return NextResponse.json({ error: "Clip não encontrado." }, { status: 404 });
    }

    return new Response(entry as BodyInit, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(entry.byteLength),
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${file}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Clip file error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao obter o clip." },
      { status: 502 },
    );
  }
}
