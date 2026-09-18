import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  decryptYouTubeRefreshToken,
  getYouTubeCookieName,
} from "@/lib/youtube-auth";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const encrypted = cookieStore.get(getYouTubeCookieName())?.value;
  const connected = Boolean(encrypted && decryptYouTubeRefreshToken(encrypted));

  return NextResponse.json({
    configured: connected,
    connected,
    scope: "https://www.googleapis.com/auth/youtube.upload",
    message: connected
      ? "YouTube conectado nesta sessão."
      : "Conecte sua conta do YouTube para publicar.",
  });
}
