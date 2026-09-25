import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";
const WORKFLOW = "clip-factory-worker.yml";
const GENERATION_ONLY_MODE = process.env.CLIP_FACTORY_GENERATION_ONLY === "true";

async function getCurrentUser() {
  if (GENERATION_ONLY_MODE) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

function githubToken() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado.");
  return token;
}

async function githubFetch(path: string, init: RequestInit = {}) {
  return fetch(GITHUB_API + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + githubToken(),
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = await request.json().catch(() => null);
  const id = typeof body?.jobId === "string" ? body.jobId.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Job inválido." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const ownedJobQuery = admin.from("clip_jobs").select("id").eq("id", id);
    const { data: ownedJob } = user
      ? await ownedJobQuery.eq("user_id", user.id).maybeSingle()
      : await ownedJobQuery.is("user_id", null).maybeSingle();

    if (!ownedJob) {
      return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });
    }

    const runsResponse = await githubFetch(
      "/repos/" + OWNER + "/" + REPO + "/actions/workflows/" + WORKFLOW + "/runs?event=repository_dispatch&per_page=30",
    );
    if (!runsResponse.ok) {
      return NextResponse.json({ error: "Não foi possível consultar o GitHub Actions." }, { status: 502 });
    }

    const data = await runsResponse.json();
    const run = data.workflow_runs?.find(
      (item: { display_title?: string; run_name?: string }) =>
        item.display_title === "Clip Factory " + id || item.run_name === "Clip Factory " + id,
    );

    if (!run?.id) {
      return NextResponse.json({ error: "A execução do worker ainda não foi encontrada." }, { status: 409 });
    }

    if (run.status !== "completed") {
      return NextResponse.json({ error: "Este processamento ainda está em andamento." }, { status: 409 });
    }

    if (run.conclusion === "success") {
      return NextResponse.json({ error: "Este processamento já foi concluído com sucesso." }, { status: 409 });
    }

    const retryResponse = await githubFetch(
      "/repos/" + OWNER + "/" + REPO + "/actions/runs/" + run.id + "/rerun-failed-jobs",
      { method: "POST" },
    );

    if (!retryResponse.ok) {
      const detail = await retryResponse.text();
      console.error("GitHub retry failed:", retryResponse.status, detail);
      return NextResponse.json(
        { error: "Não foi possível tentar novamente o processamento.", githubStatus: retryResponse.status },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      jobId: id,
      runId: run.id,
      status: "processing",
      progress: 5,
      message: "Nova tentativa iniciada no GitHub Actions.",
    }, { status: 202 });
  } catch (error) {
    console.error("Job retry error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao tentar novamente." },
      { status: 502 },
    );
  }
}
