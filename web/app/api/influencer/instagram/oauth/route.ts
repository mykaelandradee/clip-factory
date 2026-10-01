import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../../../../lib/supabase/server";
import { createInstagramOAuthState, getInstagramOAuthStateCookieName } from "../../../../../lib/instagram-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId") || "";
  if (!user) return NextResponse.redirect(new URL("/api/auth/google?next=/api/influencer/instagram/oauth?profileId=" + encodeURIComponent(profileId), request.url));
  if (!profileId) return NextResponse.redirect(new URL("/influencer-manager?instagram_profile_error=missing_profile", request.url));

  const admin = (await import("../../../../../lib/supabase/admin")).createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles").select("id").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.redirect(new URL("/influencer-manager?instagram_profile_error=invalid_profile", request.url));

  const clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.INSTAGRAM_APP_ID;
  if (!clientId) return NextResponse.redirect(new URL("/influencer-manager?instagram_profile_error=not_configured", request.url));

  const state = createInstagramOAuthState();
  const cookieStore = await cookies();
  cookieStore.set(getInstagramOAuthStateCookieName(), state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
  });
  cookieStore.set("cf_influencer_instagram_profile", profileId, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600,
  });

  const publicOrigin = process.env.CLIP_FACTORY_WEB_URL || url.origin;
  // Reuse the already-approved Meta redirect URI from the main Instagram OAuth flow.
  const redirectUri = `${publicOrigin.replace(/\/$/,"")}/api/instagram/callback`;
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish",
    enable_fb_login: "0", force_reauth: "true", state,
  });
  return NextResponse.redirect("https://www.instagram.com/oauth/authorize?" + params.toString());
}