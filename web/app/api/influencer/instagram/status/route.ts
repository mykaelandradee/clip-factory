import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected:false }, { status:401 });
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return NextResponse.json({ error:"Perfil inválido." }, { status:400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_instagram_connections")
    .select("id,username,instagram_user_id,expires_at")
    .eq("profile_id",profileId).eq("user_id",user.id).maybeSingle();
  if (error) return NextResponse.json({ error:"Não foi possível consultar a conta Instagram deste perfil." }, { status:500 });
  return NextResponse.json({
    connected:Boolean(data),
    username:data?.username ?? null,
    instagramUserId:data?.instagram_user_id ?? null,
    expiresAt:data?.expires_at ?? null,
  }, { headers:{"Cache-Control":"no-store"} });
}