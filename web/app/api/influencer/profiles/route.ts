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
  if (error) {
    console.error("Influencer profiles load failed:", error.message);
    const message = error.code === "42P01"
      ? "O banco do Influencer Manager ainda não foi configurado no Supabase. Execute a migration 20260930_influencer_manager.sql."
      : "Não foi possível carregar os perfis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
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
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 2000) : "";
  const postingTimes = Array.isArray(body?.postingTimes) ? body.postingTimes.filter((v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) : [];
  const captionMode = ["zh_random","ja_random","zh_ja_random","custom"].includes(body?.captionMode) ? body.captionMode : "zh_ja_random";
  if (!name || name.length > 80) return NextResponse.json({ error: "Informe um nome de perfil válido." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_profiles").insert({
    user_id: user.id, name, description: description || null, instagram_username: instagramUsername || null,
    posts_per_day: postsPerDay, posting_times: postingTimes, caption_mode: captionMode,
    auto_publish: false, repeat_when_exhausted: false, fixed_publish_title: typeof body?.fixedPublishTitle === "string" ? body.fixedPublishTitle.trim().slice(0, 500) || null : null, fixed_publish_description: typeof body?.fixedPublishDescription === "string" ? body.fixedPublishDescription.trim().slice(0, 5000) || null : null, share_to_feed: body?.shareToFeed !== false
  }).select("*").single();
  if (error) {
    console.error("Influencer profile creation failed:", { code: error.code, message: error.message, details: error.details });
    const message = error.code === "42P01"
      ? "O banco do Influencer Manager ainda não foi configurado no Supabase. Execute a migration 20260930_influencer_manager.sql."
      : "Não foi possível criar o perfil.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const defaultCaptions = [
    ["zh","真的太离谱了 😂"],["zh","这个瞬间太精彩了。"],["zh","看到这里真的笑了。"],["zh","今天也遇到了这种瞬间。"],
    ["zh","有时候现实比电影还精彩。"],["zh","这一幕真的值得看第二遍。"],["zh","完全没想到会这样。"],["zh","这也太有意思了吧。"],
    ["ja","これは面白すぎる 😂"],["ja","この瞬間は最高すぎる。"],["ja","ここで本当に笑った。"],["ja","今日はこんな瞬間に出会った。"],
    ["ja","現実は映画より面白い。"],["ja","これはもう一回見たくなる。"],["ja","まさかこんな展開になるとは。"],["ja","これは本当に面白い。"]
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
  for (const key of ["name","description","instagram_username","posts_per_day","posting_times","caption_mode","cover_r2_key","auto_publish","repeat_when_exhausted","fixed_publish_title","fixed_publish_description","share_to_feed"]) {
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
  const { data: profile } = await admin.from("influencer_profiles")
    .select("id,cover_r2_key")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

  const { data: items } = await admin.from("influencer_content_items")
    .select("r2_key").eq("profile_id", id).eq("user_id", user.id);

  // O banco remove os conteúdos pela FK ON DELETE CASCADE. Antes disso,
  // removemos os arquivos pesados do R2 e a capa do Storage.
  try {
    const keys = (items || []).map((item) => item.r2_key).filter((key): key is string => Boolean(key));
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET_NAME;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (keys.length && accountId && bucket && accessKeyId && secretAccessKey) {
      const { S3Client, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }));
    }
  } catch (cleanupError) {
    console.warn("Influencer profile R2 cleanup failed:", cleanupError);
  }

  if (profile.cover_r2_key) {
    const { error: coverError } = await admin.storage.from("influencer-covers").remove([profile.cover_r2_key]);
    if (coverError) console.warn("Influencer cover cleanup failed:", coverError.message);
  }

  const { error } = await admin.from("influencer_profiles").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Não foi possível excluir o perfil." }, { status: 500 });
  return NextResponse.json({ ok: true, deletedItems: items?.length || 0 });
}
