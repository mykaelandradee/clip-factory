import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "YOUTUBE_CLIENT_ID não configurado na Vercel." },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/youtube/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/youtube.upload",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
