import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";
const WORKFLOW = "clip-factory-worker.yml";
const GENERATION_ONLY_MODE = process.env.CLIP_FACTORY_GENERATION_ONLY === "true";
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const expected = Buffer.from(createAnonymousAccessToken(jobId));
    const provided = Buffer.from(token);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

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

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return NextResponse.json({ error: "Não foi possível validar o acesso ao processamento." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken : null;

  if (!JOB_ID_PATTERN.test(jobId)) {
    return NextResponse.json({ error: "jobId inválido." }, { status: 400 });
  }

  const admin = createAdminClient();
  const query = admin.from("clip_jobs").select("id,user_id").eq("id", jobId);
  const { data: storedJob, error: jobError } = user
    ? await query.eq("user_id", user.id).maybeSingle()
    : await query.is("user_id", null).maybeSingle();

  if (jobError || !storedJob || (!user && !isValidAnonymousAccessToken(jobId, accessToken))) {
    return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });
  }

  try {
    const response = await githubFetch(
      `/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=repository_dispatch&per_page=30`,
    );
    if (!response.ok) {
      return NextResponse.json({ error: "Não foi possível localizar o processamento no GitHub Actions." }, { status: 502 });
    }

    const data = await response.json();
    const run = data.workflow_runs?.find(
      (item: { id?: number; display_title?: string; run_name?: string; status?: string }) =>
        (item.display_title === `Clip Factory ${jobId}` || item.run_name === `Clip Factory ${jobId}`) &&
        item.status !== "completed",
    );

    if (!run?.id) {
      return NextResponse.json({ message: "O processamento já terminou ou ainda não iniciou no GitHub Actions." }, { status: 200 });
    }

    const cancelResponse = await githubFetch(
      `/repos/${OWNER}/${REPO}/actions/runs/${run.id}/cancel`,
      { method: "POST" },
    );

    if (!cancelResponse.ok && cancelResponse.status !== 409) {
      const detail = await cancelResponse.text();
      console.error("GitHub cancel failed:", cancelResponse.status, detail);
      return NextResponse.json({ error: "O GitHub Actions não permitiu cancelar o processamento." }, { status: 502 });
    }

    return NextResponse.json({
      message: "Processamento cancelado. Você pode alterar as opções e gerar novamente.",
      jobId,
    });
  } catch (error) {
    console.error("Clip job cancel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível cancelar o processamento." },
      { status: 502 },
    );
  }
}
