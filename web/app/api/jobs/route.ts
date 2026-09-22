import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { listR2ClipUrls } from "../../../lib/r2";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";
const WORKFLOW = "clip-factory-worker.yml";

function githubToken() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado na Vercel");
  return token;
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken()}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(path: string, init: RequestInit = {}) {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...githubHeaders(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

function validateYoutubeUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.hostname === "youtube.com" ||
      parsed.hostname.endsWith(".youtube.com") ||
      parsed.hostname === "youtu.be";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const body = await request.json().catch(() => null);
  if (!validateYoutubeUrl(body?.url)) {
    return NextResponse.json({ error: "Informe uma URL válida do YouTube" }, { status: 400 });
  }

  const count = Math.min(15, Math.max(1, Number(body.count ?? 5)));
  const minDuration = Math.max(5, Number(body.min_duration ?? 20));
  const maxDuration = Math.max(minDuration, Number(body.max_duration ?? 60));
  const subtitleLanguage = ["original", "pt-BR", "en"].includes(body.subtitle_language) ? body.subtitle_language : "original";
  const captionStyles = ["karaoke", "fire", "beasty", "youshaei", "harmozi", "cinematic"];
  const captionStyle = captionStyles.includes(body.caption_style) ? body.caption_style : "karaoke";
  const jobId = crypto.randomUUID();

  try {
    const admin = createAdminClient();
    const { error: jobError } = await admin.from("clip_jobs").insert({ id: jobId, user_id: user?.id ?? null });
    if (jobError) {
      console.error("Clip job storage failed:", jobError.message);
      return NextResponse.json({ error: "Não foi possível registrar o processamento." }, { status: 500 });
    }

    const response = await githubFetch(`/repos/${OWNER}/${REPO}/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "clip-factory-job",
        client_payload: {
          job_id: jobId,
          url: body.url.trim(),
          count,
          min_duration: minDuration,
          max_duration: maxDuration,
          subtitle_language: subtitleLanguage,
          caption_style: captionStyle,
        },
      }),
    });

    if (!response.ok) {
      console.error("GitHub dispatch failed:", response.status, await response.text());
      return NextResponse.json({ error: "Não foi possível iniciar o processamento no GitHub Actions." }, { status: 502 });
    }

    return NextResponse.json({
      jobId,
      status: "processing",
      progress: 5,
      stage: "queued",
      message: "Processamento iniciado no GitHub Actions.",
    }, { status: 202 });
  } catch (error) {
    console.error("GitHub dispatch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao iniciar processamento." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  try {
    const admin = createAdminClient();
    const ownedJobQuery = admin.from("clip_jobs").select("id").eq("id", id);
    const { data: ownedJob } = user
      ? await ownedJobQuery.eq("user_id", user.id).maybeSingle()
      : await ownedJobQuery.is("user_id", null).maybeSingle();
    if (!ownedJob) return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });

    const response = await githubFetch(
      `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=repository_dispatch&per_page=30`,
    );
    if (!response.ok) {
      return NextResponse.json({ error: "Não foi possível consultar o GitHub Actions." }, { status: 502 });
    }

    const data = await response.json();
    const run = data.workflow_runs?.find(
      (item: { display_title?: string; run_name?: string }) =>
        item.display_title === `Clip Factory ${id}` || item.run_name === `Clip Factory ${id}`,
    );

    if (!run) {
      return NextResponse.json({
        jobId: id,
        status: "processing",
        progress: 5,
        stage: "queued",
        message: "Aguardando o GitHub Actions iniciar o worker.",
      });
    }

    const status = run.status === "completed"
      ? (run.conclusion === "success" ? "completed" : "failed")
      : "processing";

    let files: Array<{ file: string; url: string }> = [];
    if (status === "completed") {
      try {
        files = await listR2ClipUrls(id);
      } catch (r2Error) {
        console.error("R2 result listing failed:", r2Error);
      }
    }

    const progress = status === "completed" ? 100 : run.status === "queued" ? 10 : 50;
    const message = status === "completed"
      ? "Processamento concluído."
      : status === "failed"
        ? "O processamento falhou."
        : run.status === "queued"
          ? "Aguardando um runner do GitHub Actions."
          : "Processando vídeo, transcrição e seleção dos clips.";

    return NextResponse.json({
      jobId: id,
      status,
      progress,
      stage: run.status,
      message,
      error: status === "failed" ? `GitHub Actions: ${run.conclusion ?? "erro"}` : undefined,
      result: status === "completed"
        ? {
            files,
            candidates: [],
          }
        : undefined,
    });
  } catch (error) {
    console.error("GitHub status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar processamento." },
      { status: 502 },
    );
  }
}
