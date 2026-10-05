import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const local = localParts(new Date(guess));
    const rendered = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    guess += desired - rendered;
  }
  return new Date(guess);
}

function nextSlot(times: string[], from = new Date(), postsPerDay = 3) {
  const valid = times.filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)).sort();
  if (!valid.length) {
    valid.push(...["09:00", "11:30", "14:00", "16:30", "19:00", "21:30", "23:00", "08:00", "12:00"].slice(0, Math.max(1, Math.min(9, postsPerDay))));
  }
  const local = localParts(from);
  const base = Date.UTC(local.year, local.month - 1, local.day);
  for (const value of valid) {
    const [hour, minute] = value.split(":").map(Number);
    const candidate = localToUtc(local.year, local.month, local.day, hour, minute);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  const [hour, minute] = valid[0].split(":").map(Number);
  const tomorrow = new Date(base + 24 * 60 * 60 * 1000);
  return localToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), hour, minute);
}


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
  const mutationRate = rateLimit(getClientKey(request, user.id), 20, 60 * 60 * 1000);
  if (!mutationRate.allowed) return NextResponse.json({ error: "Limite de criação de perfis atingido. Aguarde antes de tentar novamente." }, { status: 429, headers: { "Retry-After": String(mutationRate.retryAfterSeconds) } });
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
      : error.code === "42703"
        ? `O banco do Influencer Manager está desatualizado: a coluna "${error.message.match(/column [^ ]+/i)?.[0]?.replace(/^column /i, "") || "necessária"}" não existe. Execute novamente a migration 20260930_influencer_manager.sql no Supabase.`
        : error.code === "23502"
          ? "O banco do Influencer Manager está com uma coluna obrigatória ausente. Execute novamente a migration no Supabase."
          : "Não foi possível criar o perfil. Código do banco: " + (error.code || "desconhecido");
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const {data:existingLibrary}=await admin.from("influencer_libraries")
    .select("id").eq("user_id",user.id).eq("name",name).maybeSingle();
  let libraryId=existingLibrary?.id || null;
  if(!libraryId){
    const {data:library,error:libraryError}=await admin.from("influencer_libraries")
      .insert({user_id:user.id,name,description:"Biblioteca principal do perfil "+name})
      .select("id").single();
    if(libraryError){
      console.error("Influencer library creation failed:",libraryError);
      await admin.from("influencer_profiles").delete().eq("id",data.id).eq("user_id",user.id);
      return NextResponse.json({error:"Não foi possível criar a biblioteca do perfil."},{status:500});
    }
    libraryId=library.id;
  }

  const {error:linkError}=await admin.from("influencer_profile_libraries").insert({
    profile_id:data.id,library_id:libraryId,user_id:user.id,priority:0,enabled:true
  });
  if(linkError){
    console.error("Influencer profile library link failed:",linkError);
    await admin.from("influencer_libraries").delete().eq("id",libraryId).eq("user_id",user.id);
    await admin.from("influencer_profiles").delete().eq("id",data.id).eq("user_id",user.id);
    return NextResponse.json({error:"Não foi possível vincular a biblioteca ao perfil."},{status:500});
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
  const mutationRate = rateLimit(getClientKey(request, user.id), 60, 60 * 60 * 1000);
  if (!mutationRate.allowed) return NextResponse.json({ error: "Limite de alterações do perfil atingido. Aguarde antes de tentar novamente." }, { status: 429, headers: { "Retry-After": String(mutationRate.retryAfterSeconds) } });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Perfil inválido." }, { status: 400 });
  const allowed: Record<string, unknown> = {};
  for (const key of ["name","description","instagram_username","posts_per_day","posting_times","caption_mode","cover_r2_key","auto_publish","repeat_when_exhausted","fixed_publish_title","fixed_publish_description","share_to_feed"]) {
    if (body && Object.prototype.hasOwnProperty.call(body, key)) allowed[key] = body[key];
  }
  const admin = createAdminClient();
  const { data: current, error: currentError } = await admin.from("influencer_profiles")
    .select("posting_times,posts_per_day,auto_publish,publishing_enabled,next_publish_at")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (currentError || !current) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

  const merged = { ...current, ...allowed };
  const scheduleChanged = Object.prototype.hasOwnProperty.call(allowed, "posting_times")
    || Object.prototype.hasOwnProperty.call(allowed, "posts_per_day")
    || Object.prototype.hasOwnProperty.call(allowed, "auto_publish");
  if (scheduleChanged && merged.auto_publish && merged.publishing_enabled) {
    const postingTimes = Array.isArray(merged.posting_times) ? merged.posting_times.filter((value: unknown): value is string => typeof value === "string") : [];
    const postsPerDay = Number(merged.posts_per_day) || 3;
    allowed.next_publish_at = nextSlot(postingTimes, new Date(), postsPerDay).toISOString();
  }

  const { data, error } = await admin.from("influencer_profiles").update(allowed).eq("id", id).eq("user_id", user.id).select("*").single();
  if (error) return NextResponse.json({ error: "Não foi possível atualizar o perfil." }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const mutationRate = rateLimit(getClientKey(request, user.id), 30, 60 * 60 * 1000);
  if (!mutationRate.allowed) return NextResponse.json({ error: "Limite de exclusões de perfil atingido. Aguarde antes de tentar novamente." }, { status: 429, headers: { "Retry-After": String(mutationRate.retryAfterSeconds) } });
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
