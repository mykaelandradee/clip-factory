import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new NextResponse(`YouTube OAuth cancelado: ${error}`, { status: 400 });
  }
  if (!code) {
    return new NextResponse("Código OAuth não recebido.", { status: 400 });
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new NextResponse("Credenciais OAuth do YouTube não configuradas.", { status: 503 });
  }

  const redirectUri = `${url.origin}/api/youtube/callback`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.refresh_token) {
    console.error("YouTube OAuth token exchange failed:", data);
    return new NextResponse(
      "O Google não retornou um refresh token. Revogue o acesso do Clip Factory na sua conta Google e tente conectar novamente.",
      { status: 502 },
    );
  }

  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Clip Factory · YouTube conectado</title><style>body{font-family:system-ui;background:#09090b;color:#fff;max-width:760px;margin:60px auto;padding:24px}code{display:block;background:#18181b;padding:16px;border-radius:12px;word-break:break-all}strong{color:#7dd3fc}</style></head><body><h1>YouTube autorizado</h1><p>Copie o <strong>refresh token</strong> abaixo e salve-o como variável de ambiente <code>YOUTUBE_REFRESH_TOKEN</code> na Vercel e no GitHub Actions. Depois você pode fechar esta página.</p><code>${String(data.refresh_token).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</code><p>O token dá ao Clip Factory permissão de upload no canal autorizado.</p></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
