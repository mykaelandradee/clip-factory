import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

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
  const rate = rateLimit(getClientKey(request), 30, 60 * 1000);
  const noStore = { "Cache-Control": "no-store" };
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Muitas consultas de publicação. Aguarde alguns segundos." },
      { status: 429, headers: { ...noStore, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Entre no Clip Factory antes de consultar a publicação." },
      { status: 401, headers: noStore },
    );
  }

  const params = new URL(request.url).searchParams;
  const platform = params.get("platform");
  const jobId = params.get("jobId") || "";
  const file = params.get("file") || "";
  const runId = params.get("runId") || "";
  const startedAt = params.get("startedAt") || "";

  if (platform !== "youtube" || !jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId) || !/^clip-\d{2}\.mp4$/.test(file)) {
    return NextResponse.json({ error: "platform, jobId e file são obrigatórios." }, { status: 400, headers: noStore });
  }

  const admin = createAdminClient();
  const { data: ownedJob } = await admin
    .from("clip_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!ownedJob) {
    return NextResponse.json({ error: "Este processamento não pertence ao usuário autenticado." }, { status: 403, headers: noStore });
  }

  try {
    let run: { id?: number; status?: string; conclusion?: string; name?: string; display_title?: string } | undefined;

    if (runId && /^\d+$/.test(runId)) {
      const response = await fetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/runs/${encodeURIComponent(runId)}`,
        { headers: headers(), cache: "no-store" },
      );
      if (response.ok) {
        const candidate = await response.json();
        if (candidate?.name === "YouTube Publisher" && candidate?.id === Number(runId)) run = candidate;
      }
    }

    if (!run) {
      const response = await fetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/workflows/youtube-publisher.yml/runs?event=repository_dispatch&per_page=20`,
        { headers: headers(), cache: "no-store" },
      );
      if (!response.ok) return NextResponse.json({ error: "Não foi possível consultar o GitHub Actions." }, { status: 502, headers: noStore });

      const data = await response.json();
      const createdAfter = startedAt && !Number.isNaN(Date.parse(startedAt)) ? Date.parse(startedAt) - 5000 : Date.now() - 120000;
      run = data.workflow_runs?.find((item: { id?: number; created_at?: string; name?: string }) =>
        typeof item.id === "number" &&
        item.name === "YouTube Publisher" &&
        typeof item.created_at === "string" &&
        Date.parse(item.created_at) >= createdAfter,
      );
    }

    if (!run) return NextResponse.json({ status: "queued", message: "Aguardando o GitHub Actions iniciar a publicação." }, { headers: noStore });

    if (run.status !== "completed") {
      return NextResponse.json({
        status: run.status === "in_progress" ? "running" : "queued",
        message: run.status === "in_progress"
          ? "O GitHub Actions está enviando o vídeo para o YouTube."
          : "Publicação na fila do GitHub Actions.",
      }, { headers: noStore });
    }

    if (run.conclusion === "success") {
      return NextResponse.json({ status: "success", message: "Vídeo publicado com sucesso no YouTube." }, { headers: noStore });
    }

    return NextResponse.json({
      status: "failed",
      message: `A publicação no YouTube terminou com erro (${run.conclusion || "falha"}).`,
    }, { headers: noStore });
  } catch (error) {
    console.error("YouTube publish status error:", error);
    return NextResponse.json({ error: "Não foi possível consultar o status da publicação." }, { status: 502, headers: noStore });
  }
}
