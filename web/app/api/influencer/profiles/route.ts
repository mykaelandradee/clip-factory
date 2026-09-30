import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_profiles").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Não foi possível carregar os perfis." }, { status: 500 });
  return NextResponse.json({ profiles: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const instagramUsername = typeof body?.instagramUsername === "string" ? body.instagramUsername.trim().replace(/^@/, "") : "";
  const postsPerDay = Math.min(9, Math.max(1, Number(body?.postsPerDay) || 3));
  const postingTimes = Array.isArray(body?.postingTimes) ? body.postingTimes.filter((v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) : [];
  const captionMode = ["zh_random","ja_random","zh_ja_random","custom"].includes(body?.captionMode) ? body.captionMode : "zh_ja_random";
  if (!name || name.length > 80) return NextResponse.json({ error: "Informe um nome de perfil válido." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_profiles").insert({
    user_id: user.id, name, instagram_username: instagramUsername || null,
    posts_per_day: postsPerDay, posting_times: postingTimes, caption_mode: captionMode,
    auto_publish: false, repeat_when_exhausted: false
  }).select("*").single();
  if (error) return NextResponse.json({ error: "Não foi possível criar o perfil." }, { status: 500 });
  const defaultCaptions = [
    ["zh","今天真的太有意思了 😂"],["zh","这个瞬间真的太经典了。"],["zh","有时候真的不知道该说什么。"],["zh","生活中总有一些意想不到的瞬间。"],
    ["ja","これは本当に面白すぎる 😂"],["ja","この瞬間は本当に最高です。"],["ja","何と言えばいいのかわからない。"],["ja","日常には予想できない瞬間があります。"]
  ];
  const { error: captionsError } = await admin.from("influencer_captions").insert(
    defaultCaptions.map(([language, caption]) => ({ profile_id: data.id, language, caption }))
  );
  if (captionsError) {
    console.error("Influencer default captions creation failed:", captionsError);
  }
  return NextResponse.json({ profile: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  const allowed: Record<string, unknown> = {};
  for (const key of ["name","instagram_username","posts_per_day","posting_times","caption_mode","cover_r2_key","auto_publish","repeat_when_exhausted"]) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) allowed[key] = body[key];
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_profiles").update(allowed).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) return NextResponse.json({ error: "Não foi possível atualizar o perfil." }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("influencer_profiles").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Não foi possível excluir o perfil." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
