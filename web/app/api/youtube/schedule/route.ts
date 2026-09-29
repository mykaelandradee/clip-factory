import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "../../../../lib/youtube-auth";

export const runtime = "nodejs";

async function getAccessToken(refreshToken: string) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("YouTube OAuth não configurado.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("Não foi possível renovar a autorização do YouTube.");
  return String(data.access_token);
}

export async function GET(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401, headers: noStore });
  const admin = createAdminClient();
  const { data, error } = await admin.from("youtube_scheduled_posts")
    .select("id,job_id,file,video_id,title,scheduled_at,status,created_at,updated_at")
    .eq("user_id", user.id).order("scheduled_at", { ascending: true }).limit(50);
  if (error) return NextResponse.json({ error: "Não foi possível carregar os agendamentos do YouTube." }, { status: 500, headers: noStore });
  return NextResponse.json({ scheduledPosts: data || [] }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401, headers: noStore });

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "ID de agendamento inválido." }, { status: 400, headers: noStore });
  }

  const admin = createAdminClient();
  const { data: post } = await admin.from("youtube_scheduled_posts")
    .select("id,user_id,video_id,status").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!post) return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404, headers: noStore });
  if (post.status !== "scheduled") return NextResponse.json({ error: "Este agendamento já foi cancelado." }, { status: 409, headers: noStore });

  const { data: connection } = await admin.from("youtube_connections")
    .select("refresh_token_encrypted").eq("user_id", user.id).maybeSingle();
  if (!connection) return NextResponse.json({ error: "Conecte sua conta do YouTube antes de cancelar." }, { status: 401, headers: noStore });

  try {
    const accessToken = await getAccessToken(decryptYouTubeRefreshToken(connection.refresh_token_encrypted));
    const response = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status", {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: post.video_id, status: { privacyStatus: "private" } }),
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("YouTube schedule cancellation failed:", response.status, details.slice(0, 500));
      return NextResponse.json({ error: "Não foi possível cancelar o agendamento no YouTube." }, { status: 502, headers: noStore });
    }

    const { data: canceled, error } = await admin.from("youtube_scheduled_posts")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id).eq("status", "scheduled")
      .select("id,status").maybeSingle();

    if (error || !canceled) return NextResponse.json({ error: "O vídeo foi mantido privado, mas não foi possível atualizar o agendamento." }, { status: 500, headers: noStore });
    return NextResponse.json({ ok: true, scheduledPost: canceled }, { headers: noStore });
  } catch (error) {
    console.error("YouTube schedule cancellation error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não foi possível cancelar o agendamento no YouTube." }, { status: 502, headers: noStore });
  }
}
