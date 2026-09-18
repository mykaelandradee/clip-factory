import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "../../../../lib/youtube-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.CLIP_FACTORY_PUBLISH_API_KEY;
  if (!expected) return NextResponse.json({ error: "Publicação segura não configurada." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.job_id === "string" ? body.job_id : "";
  const connectionId = typeof body?.connection_id === "string" ? body.connection_id : "";
  if (!jobId || !connectionId) return NextResponse.json({ error: "job_id e connection_id são obrigatórios." }, { status: 400 });

  const admin = createAdminClient();
  const { data: job } = await admin.from("clip_jobs").select("id,user_id").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });

  const { data: connection } = await admin
    .from("youtube_connections")
    .select("id,refresh_token_encrypted,user_id")
    .eq("id", connectionId)
    .eq("user_id", job.user_id)
    .maybeSingle();
  if (!connection) return NextResponse.json({ error: "Conexão não encontrada." }, { status: 404 });

  const refreshToken = decryptYouTubeRefreshToken(connection.refresh_token_encrypted);
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) return NextResponse.json({ error: "Credencial do YouTube inválida ou incompleta." }, { status: 502 });

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error("YouTube access token refresh failed:", { status: tokenResponse.status, error: tokenData?.error });
    return NextResponse.json({ error: "Não foi possível renovar a autorização do YouTube." }, { status: 502 });
  }

  return NextResponse.json({ access_token: String(tokenData.access_token), expires_in: Number(tokenData.expires_in ?? 3600) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
