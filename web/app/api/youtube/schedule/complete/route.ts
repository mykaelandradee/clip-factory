import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const expected = process.env.CLIP_FACTORY_PUBLISH_API_KEY || "";
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.job_id === "string" ? body.job_id : "";
  const connectionId = typeof body?.connection_id === "string" ? body.connection_id : "";
  const file = typeof body?.file === "string" ? body.file : "";
  const videoId = typeof body?.video_id === "string" ? body.video_id : "";
  const title = typeof body?.title === "string" ? body.title : "";
  const scheduledAt = typeof body?.scheduled_at === "string" ? body.scheduled_at : "";

  if (!UUID.test(jobId) || !UUID.test(connectionId) || !/^clip-(?:0[1-9]|1[0-5])\.mp4$/i.test(file) || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId) || !title || !scheduledAt) {
    return NextResponse.json({ error: "Dados do agendamento inválidos." }, { status: 400 });
  }

  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    return NextResponse.json({ error: "A data de publicação precisa estar no futuro." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin.from("youtube_connections").select("id,user_id").eq("id", connectionId).maybeSingle();
  if (!connection) return NextResponse.json({ error: "Conexão do YouTube não encontrada." }, { status: 404 });

  const { data: job } = await admin.from("clip_jobs").select("id,user_id").eq("id", jobId).maybeSingle();
  if (!job || job.user_id !== connection.user_id) return NextResponse.json({ error: "Processamento não pertence à conexão informada." }, { status: 403 });

  const { data, error } = await admin
    .from("youtube_scheduled_posts")
    .upsert({
      user_id: connection.user_id,
      job_id: jobId,
      file,
      video_id: videoId,
      title: title.slice(0, 100),
      scheduled_at: date.toISOString(),
      status: "scheduled",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,video_id" })
    .select("id,job_id,file,video_id,title,scheduled_at,status")
    .single();

  if (error) {
    console.error("YouTube scheduled post registration failed:", { message: error.message, code: error.code });
    return NextResponse.json({ error: "Não foi possível registrar o agendamento do YouTube." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, scheduledPost: data }, { headers: { "Cache-Control": "no-store" } });
}
