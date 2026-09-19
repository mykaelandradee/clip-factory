import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ connected: false }, { status: 401 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("instagram_connections")
      .select("username, expires_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return NextResponse.json({ connected: false }, { status: 500 });

    return NextResponse.json({
      connected: Boolean(data),
      username: data?.username ?? null,
      expiresAt: data?.expires_at ?? null,
    });
  } catch (error) {
    console.error("Instagram status error:", error);
    return NextResponse.json({ connected: false }, { status: 500 });
  }
}
