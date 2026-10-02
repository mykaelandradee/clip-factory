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
    .select("id,username,instagram_user_id,expires_at,requires_reconnect")
    .eq("profile_id",profileId).eq("user_id",user.id).maybeSingle();
  if (error) return NextResponse.json({ error:"Não foi possível consultar a conta Instagram deste perfil." }, { status:500 });
  return NextResponse.json({
    connected:Boolean(data && !data.requires_reconnect),
    requiresReconnect:Boolean(data?.requires_reconnect),
    username:data?.username ?? null,
    instagramUserId:data?.instagram_user_id ?? null,
    expiresAt:data?.expires_at ?? null,
  }, { headers:{"Cache-Control":"no-store"} });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error:"Entre no Clip Factory." }, { status:401 });
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return NextResponse.json({ error:"Perfil inválido." }, { status:400 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles")
    .select("id")
    .eq("id",profileId)
    .eq("user_id",user.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error:"Perfil não encontrado." }, { status:404 });

  const { error: connectionError } = await admin.from("influencer_instagram_connections")
    .delete()
    .eq("profile_id",profileId)
    .eq("user_id",user.id);
  if (connectionError) {
    console.error("Influencer Instagram disconnect failed:",connectionError);
    return NextResponse.json({ error:"Não foi possível desvincular o Instagram deste perfil." }, { status:500 });
  }

  const { data, error: profileError } = await admin.from("influencer_profiles")
    .update({
      instagram_username:null,
      publishing_enabled:false,
      auto_publish:false,
      next_publish_at:null,
      publish_retry_count:0,
      updated_at:new Date().toISOString(),
    })
    .eq("id",profileId)
    .eq("user_id",user.id)
    .select("*")
    .single();
  if (profileError) return NextResponse.json({ error:"O Instagram foi desvinculado, mas não foi possível atualizar o perfil." }, { status:500 });

  return NextResponse.json({ ok:true, profile:data });
}
