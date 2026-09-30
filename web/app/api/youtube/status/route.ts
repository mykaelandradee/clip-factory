import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";
import { decryptYouTubeRefreshToken } from "../../../../lib/youtube-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const rate = rateLimit(getClientKey(request), 30, 60 * 1000);
  const noStore = { "Cache-Control": "no-store" };
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Muitas consultas de conexão. Aguarde alguns segundos." },
      { status: 429, headers: { ...noStore, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { configured: false, connected: false, authenticated: false },
      { headers: noStore },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("youtube_connections")
    .select("id, refresh_token_encrypted")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível consultar a conexão." },
      { status: 500, headers: noStore },
    );
  }

  let channelName: string | null = null;
  let channelId: string | null = null;

  if (data?.refresh_token_encrypted) {
    try {
      const refreshToken = decryptYouTubeRefreshToken(String(data.refresh_token_encrypted));
      if (refreshToken) {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.YOUTUBE_CLIENT_ID || "",
            client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
          cache: "no-store",
        });
        const tokenData = await tokenResponse.json().catch(() => ({}));

        if (tokenResponse.ok && tokenData.access_token) {
          const channelResponse = await fetch(
            "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
            {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
              cache: "no-store",
            },
          );
          const channelData = await channelResponse.json().catch(() => ({}));
          const channel = channelData?.items?.[0];
          channelName = channel?.snippet?.title || null;
          channelId = channel?.id || null;

          if (!channelName) {
            const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
              cache: "no-store",
            });
            const userInfo = await userInfoResponse.json().catch(() => ({}));
            channelName = userInfo?.name || userInfo?.email || null;
          }
        }
      }
    } catch (error) {
      console.warn("YouTube account name lookup failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  return NextResponse.json({
    configured: true,
    connected: Boolean(data),
    channelName,
    channelId,
    authenticated: true,
    scope: "https://www.googleapis.com/auth/youtube.upload",
    message: data ? "YouTube conectado." : "Conecte sua conta do YouTube para publicar.",
  }, { headers: noStore });
}
