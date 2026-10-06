import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const admin = createAdminClient();

  const { data: profiles, error: profilesError } = await admin
    .from("influencer_profiles")
    .select("id,name,instagram_username")
    .eq("user_id", user.id);

  if (profilesError) {
    return NextResponse.json({ error: "Não foi possível carregar os perfis do Influencer Manager." }, { status: 500 });
  }

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const profileIds = (profiles || []).map((p: any) => p.id);

  if (!profileIds.length) {
    return NextResponse.json({ scheduledPosts: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  // A agenda pertence ao estado de publicação de cada perfil.
  // Não usamos mais influencer_content_shares nem o status global do item.
  const { data: states, error: statesError } = await admin
    .from("influencer_profile_content")
    .select("id,item_id,profile_id,status,scheduled_at,published_at,error_message,created_at")
    .eq("user_id", user.id)
    .in("profile_id", profileIds)
    .in("status", ["scheduled", "published", "failed"])
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });

  if (statesError) {
    return NextResponse.json({ error: "Não foi possível carregar a agenda do Influencer Manager." }, { status: 500 });
  }

  const itemIds = Array.from(new Set((states || []).map((state: any) => state.item_id).filter(Boolean)));
  if (!itemIds.length) {
    return NextResponse.json({ scheduledPosts: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: items, error: itemsError } = await admin
    .from("influencer_content_items")
    .select("id,title,publish_title,publish_description,r2_key,result_url")
    .eq("user_id", user.id)
    .in("id", itemIds);

  if (itemsError) {
    return NextResponse.json({ error: "Não foi possível carregar os conteúdos da agenda." }, { status: 500 });
  }

  const itemMap = new Map((items || []).map((item: any) => [item.id, item]));

  const rows = (states || [])
    .map((state: any) => {
      const item = itemMap.get(state.item_id);
      const profile = profileMap.get(state.profile_id);
      if (!item || !profile) return null;

      return {
        id: state.id,
        itemId: state.item_id,
        profileId: state.profile_id,
        profileName: profile.name || "Influencer Manager",
        username: profile.instagram_username || null,
        platform: "instagram",
        title: item.publish_title || item.title || "Reel do Influencer Manager",
        file: item.r2_key ? item.r2_key.split("/").pop() : "reel.mp4",
        scheduledAt: state.scheduled_at,
        publishedAt: state.published_at || null,
        status: state.status,
        lastError: state.error_message || null,
        resultUrl: item.result_url || null,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return NextResponse.json({ scheduledPosts: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Agendamento inválido." }, { status: 400 });

  const admin = createAdminClient();

  // A UI de agenda normalmente envia o ID de influencer_profile_content.
  // Mantemos o item_id como fallback para compatibilidade com a agenda antiga.
  const { data: state } = await admin
    .from("influencer_profile_content")
    .select("id,item_id,profile_id,status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (state) {
    const { error } = await admin
      .from("influencer_profile_content")
      .update({
        status: "available",
        scheduled_at: null,
        error_message: "Agendamento cancelado pelo usuário.",
        updated_at: new Date().toISOString()
      })
      .eq("id", state.id)
      .eq("user_id", user.id);

    if (error) return NextResponse.json({ error: "Não foi possível cancelar o agendamento." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data: item } = await admin
    .from("influencer_content_items")
    .select("id,profile_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!item || !item.profile_id) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  const { data: itemState } = await admin
    .from("influencer_profile_content")
    .select("id")
    .eq("item_id", item.id)
    .eq("profile_id", item.profile_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!itemState) {
    return NextResponse.json({ error: "Agendamento não encontrado." }, { status: 404 });
  }

  const { error } = await admin
    .from("influencer_profile_content")
    .update({
      status: "available",
      scheduled_at: null,
      error_message: "Agendamento cancelado pelo usuário.",
      updated_at: new Date().toISOString()
    })
    .eq("id", itemState.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Não foi possível cancelar o agendamento." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
