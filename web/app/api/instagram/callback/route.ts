import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { encryptInstagramAccessToken, getInstagramOAuthStateCookieName } from "../../../../lib/instagram-auth";

export const runtime = "nodejs";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = readCookie(request, getInstagramOAuthStateCookieName());

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(new URL("/?instagram_error=invalid_callback", url.origin));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth_required=1", url.origin));

  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.redirect(new URL("/?instagram_error=not_configured", url.origin));
  }

  try {
    const redirectUri = new URL("/api/instagram/callback", url.origin).toString();
    const tokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
      cache: "no-store",
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token || !tokenData.user_id) {
      console.error("Instagram token exchange failed:", tokenData);
      return NextResponse.redirect(new URL("/?instagram_error=token_exchange", url.origin));
    }

    const profileResponse = await fetch(
      "https://graph.instagram.com/me?fields=user_id,username&access_token=" + encodeURIComponent(tokenData.access_token),
      { cache: "no-store" }
    );
    const profile = await profileResponse.json();

    const admin = createAdminClient();
    const { error } = await admin.from("instagram_connections").upsert({
      user_id: user.id,
      instagram_user_id: String(tokenData.user_id),
      username: profile.username ?? null,
      access_token_encrypted: encryptInstagramAccessToken(tokenData.access_token),
      expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (error) {
      console.error("Instagram connection save failed:", error.message);
      return NextResponse.redirect(new URL("/?instagram_error=save_failed", url.origin));
    }

    const response = NextResponse.redirect(new URL("/?instagram_connected=1", url.origin));
    response.cookies.delete(getInstagramOAuthStateCookieName());
    return response;
  } catch (error) {
    console.error("Instagram callback failed:", error);
    return NextResponse.redirect(new URL("/?instagram_error=callback_failed", url.origin));
  }
}
