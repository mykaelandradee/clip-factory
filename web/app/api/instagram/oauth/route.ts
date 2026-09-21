import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createInstagramOAuthState, getInstagramOAuthStateCookieName } from "../../../../lib/instagram-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/api/auth/google?next=/api/instagram/oauth", request.url));
  }

  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/?instagram_error=not_configured", request.url));

  const state = createInstagramOAuthState();
  const redirectUri = new URL("/api/instagram/callback", request.url).toString();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish",
    enable_fb_login: "0",
    force_reauth: "true",
    state,
  });

  const response = NextResponse.redirect("https://www.instagram.com/oauth/authorize?" + params.toString());
  response.cookies.set(getInstagramOAuthStateCookieName(), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
