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

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ connected: false }, { status: 401, headers: noStore });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("instagram_connections")
      .select("username, expires_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return NextResponse.json({ connected: false }, { status: 500, headers: noStore });

    return NextResponse.json({
      connected: Boolean(data),
      username: data?.username ?? null,
      expiresAt: data?.expires_at ?? null,
    }, { headers: noStore });
  } catch (error) {
    console.error("Instagram status error:", error);
    return NextResponse.json({ connected: false }, { status: 500, headers: noStore });
  }
}
