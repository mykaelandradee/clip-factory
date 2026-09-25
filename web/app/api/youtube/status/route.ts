import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

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
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Não foi possível consultar a conexão." },
      { status: 500, headers: noStore },
    );
  }

  return NextResponse.json({
    configured: true,
    connected: Boolean(data),
    authenticated: true,
    scope: "https://www.googleapis.com/auth/youtube.upload",
    message: data ? "YouTube conectado." : "Conecte sua conta do YouTube para publicar.",
  }, { headers: noStore });
}
