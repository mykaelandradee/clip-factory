import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

function isAnonymousJobAccessValid(jobId: string, token: string | null) {
  if (!token) return false;
  const secret = process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY || process.env.CLIP_FACTORY_WORKER_TOKEN || process.env.CLIP_FACTORY_GITHUB_TOKEN || "";
  if (!secret) return false;
  try {
    const expected = createHmac("sha256", secret).update("clip-factory-anonymous-job:" + jobId).digest("base64url");
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

function configured() {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET &&
    process.env.CLIP_FACTORY_GITHUB_TOKEN &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY,
  );
}

export async function POST(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Requisição muito grande." }, { status: 413, headers: noStore });
  }
  if (!configured()) return NextResponse.json({ error: "A integração do YouTube ainda não está configurada." }, { status: 503 });

  const supabase = await createClient();
  const rate = rateLimit(getClientKey(request), 5, 60 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ error: "Limite de publicações do YouTube atingido. Aguarde antes de publicar novamente." }, { status: 429, headers: { ...noStore, "Retry-After": String(rate.retryAfterSeconds) } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory antes de publicar." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const file = typeof body?.file === "string" ? body.file : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description : "";
  const publishAt = typeof body?.publishAt === "string" ? body.publishAt : "";
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken : null;

  if (!jobId || !/^clip-\d{2}\.mp4$/.test(file) || !title) return NextResponse.json({ error: "jobId, file e title são obrigatórios." }, { status: 400 });
  if (title.length > 100) return NextResponse.json({ error: "O título pode ter no máximo 100 caracteres." }, { status: 400 });
  if (description.length > 5000) return NextResponse.json({ error: "A descrição pode ter no máximo 5.000 caracteres." }, { status: 400 });
  if (publishAt) {
    const publishTimestamp = Date.parse(publishAt);
    if (Number.isNaN(publishTimestamp)) return NextResponse.json({ error: "publishAt inválido." }, { status: 400 });
    if (publishTimestamp <= Date.now()) return NextResponse.json({ error: "A data de publicação precisa estar no futuro." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin.from("youtube_connections").select("id").eq("user_id", user.id).maybeSingle();
  if (!connection) return NextResponse.json({ error: "Conecte sua conta do YouTube antes de publicar." }, { status: 401 });

  const { data: ownedJob } = await admin.from("clip_jobs").select("id,user_id").eq("id", jobId).maybeSingle();
  const ownsAuthenticatedJob = ownedJob?.user_id === user.id;
  const ownsAnonymousJob = ownedJob?.user_id == null && isAnonymousJobAccessValid(jobId, accessToken);
  if (!ownedJob || (!ownsAuthenticatedJob && !ownsAnonymousJob)) return NextResponse.json({ error: "Este processamento não pertence ao usuário autenticado." }, { status: 403 });
  if (ownsAnonymousJob) {
    const { error: claimError } = await admin.from("clip_jobs").update({ user_id: user.id }).eq("id", jobId).is("user_id", null);
    if (claimError) return NextResponse.json({ error: "Não foi possível vincular este processamento ao usuário autenticado." }, { status: 500 });
  }

  const dispatchedAt = new Date().toISOString();
  const response = await fetch("https://api.github.com/repos/mykaelandradee/clip-factory/dispatches", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.CLIP_FACTORY_GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "youtube-publish",
      client_payload: { job_id: jobId, connection_id: connection.id, file, title, description, publish_at: publishAt || null },
    }),
  });

  if (!response.ok) {
    console.error("YouTube publisher dispatch failed:", response.status, await response.text());
    return NextResponse.json({ error: "Não foi possível iniciar a publicação." }, { status: 502 });
  }

  const expectedRunTitle = `YouTube Publisher ${jobId}`;
  let runId: number | null = null;

  for (let attempt = 0; attempt < 10 && runId === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const runsResponse = await fetch(
      "https://api.github.com/repos/mykaelandradee/clip-factory/actions/workflows/youtube-publisher.yml/runs?event=repository_dispatch&per_page=20",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env.CLIP_FACTORY_GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      },
    );
    if (!runsResponse.ok) continue;

    const runsData = await runsResponse.json();
    const createdAfter = Date.parse(dispatchedAt) - 5000;
    const run = runsData.workflow_runs?.find((item: { id?: number; created_at?: string; name?: string; display_title?: string }) =>
      typeof item.id === "number" &&
      item.name === "YouTube Publisher" &&
      typeof item.created_at === "string" &&
      Date.parse(item.created_at) >= createdAfter,
    );
    if (run?.id) runId = run.id;
  }

  return NextResponse.json(
    { ok: true, status: publishAt ? "scheduled" : "queued", jobId, file, runId, startedAt: dispatchedAt },
    { status: 202 },
  );
}
