import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";
import { encryptYouTubeRefreshToken, getOAuthStateCookieName } from "../../../lib/youtube-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const returnedState = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(getOAuthStateCookieName())?.value;
  cookieStore.delete(getOAuthStateCookieName());

  if (error) return new NextResponse(`YouTube OAuth cancelado: ${error}`, { status: 400 });
  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return new NextResponse("Validação OAuth inválida ou expirada. Tente conectar novamente.", { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth_required=1", url.origin));

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY) {
    return new NextResponse("A configuração segura do YouTube não está completa.", { status: 503 });
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/youtube/callback`, grant_type: "authorization_code",
    }),
  });
  const data = await response.json();

  if (!response.ok || !data.refresh_token) {
    console.error("YouTube OAuth token exchange failed:", { status: response.status, error: data?.error });
    return new NextResponse("O Google não retornou uma autorização válida. Revise a configuração OAuth e tente novamente.", { status: 502 });
  }

  const admin = createAdminClient();
  const { error: dbError } = await admin.from("youtube_connections").upsert({
    user_id: user.id,
    refresh_token_encrypted: encryptYouTubeRefreshToken(String(data.refresh_token)),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });

  if (dbError) {
    console.error("YouTube connection storage failed:", dbError.message);
    return new NextResponse("Não foi possível armazenar a conexão do YouTube.", { status: 500 });
  }

  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clip Factory · YouTube conectado</title><style>body{font-family:system-ui;background:#09090b;color:#fff;max-width:720px;margin:60px auto;padding:24px}main{background:#18181b;border:1px solid #27272a;border-radius:20px;padding:28px}a{display:inline-block;margin-top:18px;background:#fff;color:#09090b;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700}</style></head><body><main><h1>YouTube conectado</h1><p>Sua conta do YouTube foi vinculada ao seu usuário do Clip Factory.</p><p>A autorização fica armazenada de forma protegida no banco de dados e não no navegador.</p><a href="/">Voltar ao Clip Factory</a></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
