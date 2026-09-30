import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

async function auth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_content_items").select("*").eq("profile_id", profileId).eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Não foi possível carregar a biblioteca." }, { status: 500 });
  return NextResponse.json({ items: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const profileId = typeof body?.profileId === "string" ? body.profileId : "";
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!profileId || !sourceUrl || sourceUrl.length > 2048) return NextResponse.json({ error: "Informe o perfil e a URL do vídeo." }, { status: 400 });
  let parsed: URL;
  try { parsed = new URL(sourceUrl); } catch { return NextResponse.json({ error: "URL inválida." }, { status: 400 }); }
  if (parsed.protocol !== "https:") return NextResponse.json({ error: "A URL precisa usar HTTPS." }, { status: 400 });
  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles").select("id").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
  const { data: item, error } = await admin.from("influencer_content_items").insert({
    profile_id: profileId, user_id: user.id, source_url: sourceUrl, title: title || null, source_type: "url", status: "queued"
  }).select("*").single();
  if (error) return NextResponse.json({ error: "Não foi possível adicionar o vídeo à biblioteca." }, { status: 500 });
  return NextResponse.json({ item }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Conteúdo inválido." }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("influencer_content_items").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Não foi possível remover o conteúdo." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
