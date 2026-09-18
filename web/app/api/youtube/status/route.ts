import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const configured = Boolean(
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN,
  );

  return NextResponse.json({
    configured,
    scope: "https://www.googleapis.com/auth/youtube.upload",
    message: configured
      ? "YouTube está configurado para publicação."
      : "Configure as credenciais OAuth do YouTube.",
  });
}
