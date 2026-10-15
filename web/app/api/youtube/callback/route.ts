import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { encryptYouTubeRefreshToken, getOAuthStateCookieName } from "../../../../lib/youtube-auth";
import { safeEqual } from "../../../../lib/security";
import { getMyChannel, getYouTubeAccessToken, INFLUENCER_YOUTUBE_PROFILE_COOKIE } from "../../../../lib/youtube-upload";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = process.env.CLIP_FACTORY_WEB_URL?.replace(/\/$/, "") || url.origin;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(getOAuthStateCookieName())?.value;
  const influencerProfileId = cookieStore.get(INFLUENCER_YOUTUBE_PROFILE_COOKIE)?.value || "";
  cookieStore.delete(getOAuthStateCookieName());
  cookieStore.delete(INFLUENCER_YOUTUBE_PROFILE_COOKIE);

  // Conexão iniciada por um perfil do Influencer Manager: fluxo próprio, que
  // grava o canal no perfil e volta para a tela do Influencer Manager.
  if (influencerProfileId) {
    const back = (reason: string) => NextResponse.redirect(new URL(
      "/influencer-manager?profileId=" + encodeURIComponent(influencerProfileId) + "&" + reason, publicOrigin));
    if (error) return back("youtube_profile_error=canceled");
    if (!code || !safeEqual(returnedState, expectedState)) return back("youtube_profile_error=invalid_callback");
    return connectInfluencerYouTube(code, influencerProfileId, publicOrigin, back);
  }

  if (error) return new NextResponse("Autorização do YouTube cancelada ou recusada.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!code || !safeEqual(returnedState, expectedState)) {
    return new NextResponse("Validação OAuth inválida ou expirada. Tente conectar novamente.", { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth_required=1", publicOrigin));

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY) {
    return new NextResponse("A configuração segura do YouTube não está completa.", { status: 503 });
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: `${publicOrigin}/api/youtube/callback`, grant_type: "authorization_code",
    }),
  });
  const data = await response.json();

  if (!response.ok || !data.refresh_token) {
    console.error("YouTube OAuth token exchange failed:", { status: response.status, error: data?.error });
    return new NextResponse("O Google não retornou uma autorização válida. Revise a configuração OAuth e tente novamente.", { status: 502 });
  }

  const admin = createAdminClient();
  const { error: dbError } = await admin.from("youtube_connections").upsert({
    user_id: user.id,
    refresh_token_encrypted: encryptYouTubeRefreshToken(String(data.refresh_token)),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (dbError) {
    console.error("YouTube connection storage failed:", dbError.message);
    return new NextResponse("Não foi possível armazenar a conexão do YouTube.", { status: 500 });
  }

  return NextResponse.redirect(new URL("/?youtube_connected=1#", publicOrigin));
}

async function connectInfluencerYouTube(
  code: string,
  profileId: string,
  publicOrigin: string,
  back: (reason: string) => NextResponse,
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth_required=1", publicOrigin));

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY) return back("youtube_profile_error=not_configured");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles").select("id,platform").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  if (!profile) return back("youtube_profile_error=invalid_profile");
  if (profile.platform !== "youtube") return back("youtube_profile_error=wrong_platform");

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: `${publicOrigin}/api/youtube/callback`, grant_type: "authorization_code",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.refresh_token) {
      console.error("Influencer YouTube token exchange failed:", { status: response.status, error: data?.error });
      return back("youtube_profile_error=token_exchange");
    }

    const accessToken = data.access_token ? String(data.access_token) : await getYouTubeAccessToken(String(data.refresh_token));
    const channel = await getMyChannel(accessToken);

    const { data: usedElsewhere } = await admin.from("influencer_youtube_connections")
      .select("profile_id").eq("user_id", user.id).eq("channel_id", channel.id).neq("profile_id", profileId).maybeSingle();
    if (usedElsewhere) return back("youtube_profile_error=channel_in_use");

    const { error: saveError } = await admin.from("influencer_youtube_connections").upsert({
      profile_id: profileId,
      user_id: user.id,
      channel_id: channel.id,
      channel_title: channel.title,
      channel_handle: channel.handle,
      refresh_token_encrypted: encryptYouTubeRefreshToken(String(data.refresh_token)),
      requires_reconnect: false,
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id" });
    if (saveError) {
      console.error("Influencer YouTube connection save failed:", saveError.message);
      return back("youtube_profile_error=save_failed");
    }
    await admin.from("influencer_profiles")
      .update({ youtube_channel_title: channel.title || channel.handle, updated_at: new Date().toISOString() })
      .eq("id", profileId).eq("user_id", user.id);
    return back("youtube_profile_connected=1");
  } catch (err) {
    console.error("Influencer YouTube callback failed:", err instanceof Error ? err.message : err);
    return back("youtube_profile_error=no_channel");
  }
}
