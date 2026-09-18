import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../../lib/supabase/server";
import { createOAuthState, getOAuthStateCookieName } from "../../../lib/youtube-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth_required=1", request.url));

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "YOUTUBE_CLIENT_ID não configurado na Vercel." }, { status: 503 });

  const state = createOAuthState();
  const cookieStore = await cookies();
  cookieStore.set(getOAuthStateCookieName(), state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/youtube/callback`;
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    access_type: "offline", prompt: "consent",
    scope: "https://www.googleapis.com/auth/youtube.upload", state,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
