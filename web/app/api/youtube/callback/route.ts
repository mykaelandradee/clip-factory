import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { encryptYouTubeRefreshToken, getOAuthStateCookieName } from "../../../../lib/youtube-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = url.origin;
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
  if (!user) return NextResponse.redirect(new URL("/?auth_required=1", publicOrigin));

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
      redirect_uri: `${publicOrigin}/api/youtube/callback`, grant_type: "authorization_code",
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

  return NextResponse.redirect(new URL("/?youtube_connected=1#", publicOrigin));
}
