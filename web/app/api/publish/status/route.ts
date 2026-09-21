import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";

function headers() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado na Vercel.");
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory antes de consultar a publicação." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const platform = params.get("platform");
  const jobId = params.get("jobId") || "";
  const file = params.get("file") || "";
  const runId = params.get("runId") || "";
  const startedAt = params.get("startedAt") || "";

  if (platform !== "youtube" || !jobId || !/^clip-\d{2}\.mp4$/.test(file)) {
    return NextResponse.json({ error: "platform, jobId e file são obrigatórios." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: ownedJob } = await admin.from("clip_jobs").select("id").eq("id", jobId).eq("user_id", user.id).maybeSingle();
  if (!ownedJob) return NextResponse.json({ error: "Este processamento não pertence ao usuário autenticado." }, { status: 403 });

  try {
    let run: { id?: number; status?: string; conclusion?: string } | undefined;

    if (runId) {
      const response = await fetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/runs/${encodeURIComponent(runId)}`,
        { headers: headers(), cache: "no-store" },
      );
      if (response.ok) run = await response.json();
    } else {
      const response = await fetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/workflows/youtube-publisher.yml/runs?event=repository_dispatch&per_page=20`,
        { headers: headers(), cache: "no-store" },
      );
      if (!response.ok) return NextResponse.json({ error: "Não foi possível consultar o GitHub Actions." }, { status: 502 });

      const data = await response.json();
      const createdAfter = startedAt ? Date.parse(startedAt) - 5000 : Date.now() - 120000;
      run = data.workflow_runs?.find((item: { id?: number; created_at?: string }) =>
        typeof item.id === "number" && typeof item.created_at === "string" && Date.parse(item.created_at) >= createdAfter,
      );
    }

    if (!run) return NextResponse.json({ status: "queued", message: "Aguardando o GitHub Actions iniciar a publicação." });

    if (run.status !== "completed") {
      return NextResponse.json({ status: run.status === "in_progress" ? "running" : "queued", message: run.status === "in_progress" ? "O GitHub Actions está enviando o vídeo para o YouTube." : "Publicação na fila do GitHub Actions." });
    }

    if (run.conclusion === "success") {
      return NextResponse.json({ status: "success", message: "Vídeo publicado com sucesso no YouTube." });
    }

    return NextResponse.json({ status: "failed", message: `A publicação no YouTube terminou com erro (${run.conclusion || "falha"}).` });
  } catch (error) {
    console.error("YouTube publish status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao consultar a publicação." }, { status: 502 });
  }
}
