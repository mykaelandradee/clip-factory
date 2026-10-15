import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "../../../../../lib/youtube-auth";
import { revokeGoogleToken } from "../../../../../lib/youtube-upload";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401, headers: noStore });
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return NextResponse.json({ error: "Perfil inválido." }, { status: 400, headers: noStore });

  const admin = createAdminClient();
  const [{ data, error }, { data: posts }] = await Promise.all([
    admin.from("influencer_youtube_connections")
      .select("channel_id,channel_title,channel_handle,requires_reconnect,last_error")
      .eq("profile_id", profileId).eq("user_id", user.id).maybeSingle(),
    admin.from("influencer_youtube_posts")
      .select("id,title,status,youtube_video_id,privacy_status,error_message,scheduled_at,published_at,created_at")
      .eq("profile_id", profileId).eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(5),
  ]);
  if (error) return NextResponse.json({ error: "Não foi possível consultar o canal do YouTube deste perfil." }, { status: 500, headers: noStore });

  return NextResponse.json({
    connected: Boolean(data && !data.requires_reconnect),
    requiresReconnect: Boolean(data?.requires_reconnect),
    channelId: data?.channel_id ?? null,
    channelTitle: data?.channel_title ?? null,
    channelHandle: data?.channel_handle ?? null,
    lastError: data?.last_error ?? null,
    recentPosts: posts || [],
  }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });

  const admin = createAdminClient();
  const { data: connection } = await admin.from("influencer_youtube_connections")
    .select("refresh_token_encrypted")
    .eq("profile_id", profileId).eq("user_id", user.id).maybeSingle();
  if (!connection) return NextResponse.json({ ok: true });

  const { error } = await admin.from("influencer_youtube_connections")
    .delete().eq("profile_id", profileId).eq("user_id", user.id);
  if (error) {
    console.error("Influencer YouTube disconnect failed:", error.message);
    return NextResponse.json({ error: "Não foi possível desvincular o YouTube deste perfil." }, { status: 500 });
  }

  // Envios pendentes deste perfil não têm mais para onde ir.
  await admin.from("influencer_youtube_posts")
    .update({ status: "canceled", error_message: "Canal desvinculado.", updated_at: new Date().toISOString() })
    .eq("profile_id", profileId).eq("user_id", user.id).eq("status", "scheduled");

  const refreshToken = decryptYouTubeRefreshToken(connection.refresh_token_encrypted);
  if (refreshToken) await revokeGoogleToken(refreshToken);

  // Sem canal, o perfil do YouTube não tem onde publicar.
  const { data: profile } = await admin.from("influencer_profiles")
    .update({
      youtube_channel_title: null,
      publishing_enabled: false,
      auto_publish: false,
      next_publish_at: null,
      publish_retry_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId).eq("user_id", user.id)
    .select("*").maybeSingle();

  return NextResponse.json({ ok: true, profile });
}
