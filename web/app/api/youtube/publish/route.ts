import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

function configured() {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET &&
    process.env.CLIP_FACTORY_GITHUB_TOKEN &&
    process.env.CLIP_FACTORY_PUBLISH_API_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY,
  );
}

export async function POST(request: Request) {
  if (!configured()) return NextResponse.json({ error: "A integração do YouTube ainda não está configurada." }, { status: 503 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory antes de publicar." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const file = typeof body?.file === "string" ? body.file : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description : "";
  const publishAt = typeof body?.publishAt === "string" ? body.publishAt : "";

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

  const { data: ownedJob } = await admin.from("clip_jobs").select("id").eq("id", jobId).eq("user_id", user.id).maybeSingle();
  if (!ownedJob) return NextResponse.json({ error: "Este processamento não pertence ao usuário autenticado." }, { status: 403 });

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

  // repository_dispatch returns 204, so resolve the created workflow run explicitly.
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
    const run = runsData.workflow_runs?.find((item: { id?: number; created_at?: string }) =>
      typeof item.id === "number" && typeof item.created_at === "string" && Date.parse(item.created_at) >= createdAfter,
    );
    if (run?.id) runId = run.id;
  }

  return NextResponse.json(
    { ok: true, status: publishAt ? "scheduled" : "queued", jobId, file, runId, startedAt: dispatchedAt },
    { status: 202 },
  );
}
