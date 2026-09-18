import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { createAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin.from("youtube_connections").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Não foi possível desconectar o YouTube." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
