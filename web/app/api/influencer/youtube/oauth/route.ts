import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { createOAuthState, getOAuthStateCookieName } from "../../../../../lib/youtube-auth";
import { INFLUENCER_YOUTUBE_PROFILE_COOKIE, YOUTUBE_SCOPES } from "../../../../../lib/youtube-upload";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId") || "";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/google?next=" + encodeURIComponent("/api/influencer/youtube/oauth?profileId=" + profileId), request.url));
  }
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) {
    return NextResponse.redirect(new URL("/influencer-manager?youtube_profile_error=missing_profile", request.url));
  }

  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles").select("id").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.redirect(new URL("/influencer-manager?youtube_profile_error=invalid_profile", request.url));

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId || !process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.redirect(new URL("/influencer-manager?youtube_profile_error=not_configured&profileId=" + encodeURIComponent(profileId), request.url));
  }

  const state = createOAuthState();
  const cookieStore = await cookies();
  const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  cookieStore.set(getOAuthStateCookieName(), state, cookieOptions);
  cookieStore.set(INFLUENCER_YOUTUBE_PROFILE_COOKIE, profileId, cookieOptions);

  // Reutiliza o redirect URI já cadastrado no Google Cloud para o fluxo principal do YouTube.
  const publicOrigin = process.env.CLIP_FACTORY_WEB_URL?.replace(/\/$/, "") || url.origin;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${publicOrigin}/api/youtube/callback`,
    response_type: "code",
    access_type: "offline",
    // select_account permite escolher a conta/canal de marca certo para este perfil.
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: YOUTUBE_SCOPES,
    state,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
