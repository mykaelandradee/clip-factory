import { NextResponse } from "next/server";

export const runtime = "nodejs";

function configured() {
  return Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN &&
    process.env.CLIP_FACTORY_GITHUB_TOKEN,
  );
}

export async function POST(request: Request) {
  if (!configured()) {
    return NextResponse.json(
      { error: "YouTube ainda não está configurado." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const file = typeof body?.file === "string" ? body.file : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description = typeof body?.description === "string" ? body.description : "";
  const publishAt = typeof body?.publishAt === "string" ? body.publishAt : "";

  if (!jobId || !/^clip-\\d{2}\\.mp4$/.test(file) || !title) {
    return NextResponse.json({ error: "jobId, file e title são obrigatórios." }, { status: 400 });
  }

  if (publishAt && Number.isNaN(Date.parse(publishAt))) {
    return NextResponse.json({ error: "publishAt inválido." }, { status: 400 });
  }

  const response = await fetch(
    "https://api.github.com/repos/mykaelandradee/clip-factory/dispatches",
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.CLIP_FACTORY_GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "youtube-publish",
        client_payload: {
          job_id: jobId,
          file,
          title,
          description,
          publish_at: publishAt || null,
        },
      }),
    },
  );

  if (!response.ok) {
    console.error("YouTube publisher dispatch failed:", response.status, await response.text());
    return NextResponse.json({ error: "Não foi possível iniciar a publicação." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, status: publishAt ? "scheduled" : "queued" }, { status: 202 });
}
