import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { listR2ClipUrls } from "../../../lib/r2";
import { getClientKey, rateLimit } from "../../../lib/rate-limit";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";
const WORKFLOW = "clip-factory-worker.yml";
const GENERATION_ONLY_MODE = process.env.CLIP_FACTORY_GENERATION_ONLY === "true";
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

function getAnonymousJobSecret() {
  return process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY || process.env.CLIP_FACTORY_WORKER_TOKEN || process.env.CLIP_FACTORY_GITHUB_TOKEN || "";
}

function createAnonymousAccessToken(jobId: string) {
  const secret = getAnonymousJobSecret();
  if (!secret) throw new Error("Proteção de jobs anônimos não está configurada.");
  return createHmac("sha256", secret).update(`clip-factory-anonymous-job:${jobId}`).digest("base64url");
}

function isValidAnonymousAccessToken(jobId: string, token: string | null) {
  if (!token) return false;
  try {
    const expectedBuffer = Buffer.from(createAnonymousAccessToken(jobId));
    const providedBuffer = Buffer.from(token);
    return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

async function findOwnedJob(admin: ReturnType<typeof createAdminClient>, id: string, userId: string | null, accessToken: string | null) {
  const query = admin.from("clip_jobs").select("id").eq("id", id);
  if (userId) {
    const { data } = await query.eq("user_id", userId).maybeSingle();
    return Boolean(data);
  }
  if (!isValidAnonymousAccessToken(id, accessToken)) return false;
  const { data } = await query.is("user_id", null).maybeSingle();
  return Boolean(data);
}

async function getCurrentUser() {
  if (GENERATION_ONLY_MODE) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

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
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "youtube.com" ||
        parsed.hostname.endsWith(".youtube.com") ||
        parsed.hostname === "youtu.be");
  } catch {
    return false;
  }
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error("Clip job auth configuration error:", error);
    return NextResponse.json(
      { error: "O backend do Clip Factory não está configurado para iniciar novos jobs." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Requisição muito grande." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  const body = await request.json().catch(() => null);
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : null;
  if (!validateYoutubeUrl(payload?.url)) {
    return NextResponse.json({ error: "Informe uma URL válida do YouTube" }, { status: 400 });
  }

  const count = parsePositiveInt(payload?.count ?? 5, 5, 1, 15);
  const minDuration = parsePositiveInt(payload?.min_duration ?? 20, 20, 5, 300);
  const maxDuration = parsePositiveInt(payload?.max_duration ?? 60, 60, minDuration, 300);
  const subtitleLanguage = typeof payload?.subtitle_language === "string" && ["original", "pt-BR", "en"].includes(payload.subtitle_language)
    ? payload.subtitle_language
    : "original";
  const captionStyles = ["karaoke", "fire", "beasty", "youshaei", "harmozi", "cinematic"];
  const captionStyle = typeof payload?.caption_style === "string" && captionStyles.includes(payload.caption_style)
    ? payload.caption_style
    : "karaoke";
  const jobId = crypto.randomUUID();
  let accessToken: string | null = null;
  try {
    if (!user) accessToken = createAnonymousAccessToken(jobId);
    const admin = createAdminClient();
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error: cleanupError } = await admin.from("clip_jobs").delete().lt("created_at", cutoff);
      if (cleanupError) console.warn("Old clip job cleanup skipped:", cleanupError.message);
    } catch (cleanupError) {
      console.warn("Old clip job cleanup failed:", cleanupError);
    }
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
          url: String(payload?.url).trim(),
          count,
          min_duration: minDuration,
          max_duration: maxDuration,
          subtitle_language: subtitleLanguage,
          caption_style: captionStyle,
        },
      }),
    });

    if (!response.ok) {
      const githubBody = await response.text();
      console.error("GitHub dispatch failed:", {
        status: response.status,
        statusText: response.statusText,
        body: githubBody,
      });
      const cleanupQuery = admin.from("clip_jobs").delete().eq("id", jobId);
      if (user) {
        await cleanupQuery.eq("user_id", user.id);
      } else {
        await cleanupQuery.is("user_id", null);
      }
      return NextResponse.json({
        error: "Não foi possível iniciar o processamento no GitHub Actions.",
        githubStatus: response.status,
      }, { status: 502 });
    }

    return NextResponse.json({
      jobId,
      accessToken,
      status: "processing",
      progress: 5,
      stage: "queued",
      message: "Processamento iniciado no GitHub Actions.",
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    try {
      const cleanupAdmin = createAdminClient();
      const cleanupQuery = cleanupAdmin.from("clip_jobs").delete().eq("id", jobId);
      if (user) {
        await cleanupQuery.eq("user_id", user.id);
      } else {
        await cleanupQuery.is("user_id", null);
      }
    } catch (cleanupError) {
      console.error("Failed to clean up orphan clip job:", cleanupError);
    }
    console.error("GitHub dispatch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao iniciar processamento." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error("Clip job status auth configuration error:", error);
    return NextResponse.json(
      { error: "O backend do Clip Factory não está configurado para consultar jobs." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const limit = rateLimit(getClientKey(request, user?.id), 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Muitas consultas de status. Aguarde alguns segundos.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const headerToken = request.headers.get("authorization");
  const accessToken = headerToken?.startsWith("Bearer ")
    ? headerToken.slice(7).trim()
    : params.get("accessToken");
  if (!id || !JOB_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    if (!await findOwnedJob(admin, id, user?.id ?? null, accessToken)) return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });

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
        generatedCount: 0,
      });
    }

    let currentStep = "";
    let failedStep = "";
    try {
      const jobsResponse = await githubFetch(
        `/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=10`,
      );
      if (jobsResponse.ok) {
        const jobsData = await jobsResponse.json();
        const jobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
        const job = jobs.find((item: { status?: string; conclusion?: string }) =>
          item.status !== "completed" || item.conclusion !== "success",
        ) ?? jobs[0];
        const steps = Array.isArray(job?.steps) ? job.steps : [];
        const active = steps.find((step: { status?: string }) => step.status === "in_progress");
        const failed = steps.find((step: { conclusion?: string }) =>
          ["failure", "cancelled", "timed_out"].includes(String(step.conclusion)),
        );
        currentStep = String(active?.name ?? "");
        failedStep = String(failed?.name ?? "");
      }
    } catch (jobsError) {
      console.error("GitHub job details lookup failed:", jobsError);
    }

    const status = run.status === "completed"
      ? (run.conclusion === "success"
          ? "completed"
          : run.conclusion === "cancelled"
            ? "canceled"
            : "failed")
      : "processing";

    let files: Array<{ file: string; url: string }> = [];
    if (status === "completed") {
      try {
        files = await listR2ClipUrls(id);
      } catch (r2Error) {
        console.error("R2 result listing failed:", r2Error);
      }
    }

    const stepProgress = (() => {
      const step = currentStep.toLowerCase();
      if (step.includes("upload")) return 95;
      if (step.includes("render")) return 78;
      if (step.includes("run clip factory")) return 65;
      if (step.includes("cache") || step.includes("python")) return 35;
      if (step.includes("youtube") || step.includes("deno") || step.includes("yt-dlp")) return 25;
      return currentStep ? 20 : 15;
    })();

    const progress = status === "completed"
      ? 100
      : run.status === "queued"
        ? 10
        : stepProgress;

    const failureCategory = (() => {
      const step = failedStep.toLowerCase();
      if (step.includes("verify ytdlp") || step.includes("youtube") || step.includes("deno")) return "youtube_download";
      if (step.includes("run clip factory") || step.includes("transcri") || step.includes("translat")) return "clip_processing";
      if (step.includes("upload clips") || step.includes("r2")) return "r2_upload";
      if (step.includes("cache") || step.includes("python")) return "worker_setup";
      if (run.conclusion === "cancelled" || run.conclusion === "timed_out") return "worker_timeout";
      return "worker_failed";
    })();

    const failureMessage = status === "failed"
      ? failureCategory === "youtube_download"
        ? "Não foi possível baixar ou analisar o vídeo do YouTube."
        : failureCategory === "clip_processing"
          ? "O processamento dos clips falhou durante análise, transcrição, tradução ou renderização."
          : failureCategory === "r2_upload"
            ? "Os clips foram gerados, mas não foi possível enviá-los ao armazenamento temporário."
            : failureCategory === "worker_timeout"
              ? "O processamento excedeu o tempo permitido ou foi cancelado."
              : "O worker terminou com erro. Tente novamente."
      : undefined;

    const message = status === "completed"
      ? "Processamento concluído."
      : status === "canceled"
        ? "Processamento cancelado."
        : status === "failed"
        ? failureMessage!
        : run.status === "queued"
          ? "Aguardando um runner do GitHub Actions."
          : currentStep
            ? `Processando: ${currentStep}.`
            : "Processando vídeo, transcrição e seleção dos clips.";

    return NextResponse.json({
      jobId: id,
      status,
      progress,
      stage: currentStep || run.status,
      message,
      generatedCount: files.length,
      error: status === "failed"
        ? `${failureMessage} (${run.conclusion ?? "erro"}${failedStep ? ` · ${failedStep}` : ""})`
        : undefined,
      errorCategory: status === "failed" ? failureCategory : undefined,
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
