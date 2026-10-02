import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { encryptInstagramAccessToken, exchangeInstagramShortLivedToken, getInstagramOAuthStateCookieName } from "../../../../lib/instagram-auth";

export const runtime = "nodejs";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = process.env.CLIP_FACTORY_WEB_URL || url.origin;
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const expectedState = readCookie(request, getInstagramOAuthStateCookieName());
  const influencerProfileId = readCookie(request, "cf_influencer_instagram_profile");

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(new URL("/?instagram_error=invalid_callback", publicOrigin));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/?auth_error=session_required", publicOrigin));
  }

  const clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!clientId || !clientSecret || !process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.redirect(new URL("/?instagram_error=not_configured", publicOrigin));
  }

  try {
    const redirectUri = `${publicOrigin.replace(/\/$/, "")}/api/instagram/callback`;
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
      return NextResponse.redirect(new URL("/?instagram_error=token_exchange", publicOrigin));
    }

    const longLived = await exchangeInstagramShortLivedToken(String(tokenData.access_token));

    const profileResponse = await fetch(
      "https://graph.instagram.com/me?fields=user_id,username&access_token=" + encodeURIComponent(longLived.accessToken),
      { cache: "no-store" }
    );
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.user_id) {
      console.error("Instagram profile lookup failed:", profile);
      return NextResponse.redirect(new URL("/?instagram_error=profile_lookup", publicOrigin));
    }

    const admin = createAdminClient();
    const { error } = await admin.from("instagram_connections").upsert({
      user_id: user.id,
      instagram_user_id: String(profile.user_id),
      username: profile.username ?? null,
      access_token_encrypted: encryptInstagramAccessToken(longLived.accessToken),
      expires_at: longLived.expiresIn > 0 ? new Date(Date.now() + longLived.expiresIn * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (error) {
      console.error("Instagram connection save failed:", error.message);
      return NextResponse.redirect(new URL(influencerProfileId ? "/influencer-manager?instagram_profile_error=save_failed" : "/?instagram_error=save_failed", publicOrigin));
    }

    if (influencerProfileId) {
      const { data: ownedProfile } = await admin.from("influencer_profiles")
        .select("id").eq("id", influencerProfileId).eq("user_id", user.id).maybeSingle();
      if (!ownedProfile) {
        return NextResponse.redirect(new URL("/influencer-manager?instagram_profile_error=invalid_profile", publicOrigin));
      }
      const { error: influencerError } = await admin.from("influencer_instagram_connections").upsert({
        profile_id: influencerProfileId,
        user_id: user.id,
        instagram_user_id: String(profile.user_id),
        username: profile.username ?? null,
        access_token_encrypted: encryptInstagramAccessToken(longLived.accessToken),
        expires_at: longLived.expiresIn > 0 ? new Date(Date.now() + longLived.expiresIn * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "profile_id" });
      if (influencerError) {
        console.error("Influencer Instagram connection save failed:", influencerError.message);
        return NextResponse.redirect(new URL("/influencer-manager?instagram_profile_error=save_failed", publicOrigin));
      }
      await admin.from("influencer_profiles").update({
        instagram_username: profile.username ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", influencerProfileId).eq("user_id", user.id);
    }

    const response = NextResponse.redirect(new URL(
      influencerProfileId ? "/influencer-manager?profileId=" + encodeURIComponent(influencerProfileId) + "&instagram_profile_connected=1" : "/?instagram_connected=1#",
      publicOrigin
    ));
    response.cookies.delete(getInstagramOAuthStateCookieName());
    response.cookies.delete("cf_influencer_instagram_profile");
    return response;
  } catch (error) {
    console.error("Instagram callback failed:", error);
    return NextResponse.redirect(new URL("/?instagram_error=callback_failed", publicOrigin));
  }
}
