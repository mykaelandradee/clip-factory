import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

async function auth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const admin = createAdminClient();

  const { data: libraries, error } = await admin
    .from("influencer_libraries")
    .select("id,name,description,created_at,updated_at")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: "Não foi possível carregar as bibliotecas." }, { status: 500 });

  const ids = (libraries || []).map((library: any) => library.id);
  const { data: links, error: linksError } = ids.length
    ? await admin.from("influencer_profile_libraries")
        .select("library_id,profile_id,priority,enabled")
        .eq("user_id", user.id)
        .in("library_id", ids)
    : { data: [], error: null };

  if (linksError) return NextResponse.json({ error: "Não foi possível carregar os vínculos das bibliotecas." }, { status: 500 });

  const profileIds = Array.from(new Set((links || []).map((row: any) => row.profile_id).filter(Boolean)));
  const { data: profiles } = profileIds.length
    ? await admin.from("influencer_profiles").select("id,name").eq("user_id", user.id).in("id", profileIds)
    : { data: [] };
  const profileNames = new Map((profiles || []).map((profile: any) => [profile.id, profile.name]));

  const { data: items } = ids.length
    ? await admin.from("influencer_content_items").select("id,library_id").eq("user_id", user.id).in("library_id", ids)
    : { data: [] };

  const linkedByLibrary = new Map<string, any[]>();
  for (const row of links || []) {
    const list = linkedByLibrary.get(row.library_id) || [];
    list.push({
      profile_id: row.profile_id,
      profile_name: profileNames.get(row.profile_id) || "Perfil",
      priority: row.priority || 0,
      enabled: row.enabled !== false
    });
    linkedByLibrary.set(row.library_id, list);
  }

  return NextResponse.json({
    libraries: (libraries || []).map((library: any) => ({
      ...library,
      item_count: (items || []).filter((item: any) => item.library_id === library.id).length,
      profiles: linkedByLibrary.get(library.id) || []
    }))
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const mutationRate = rateLimit(getClientKey(request, user.id), 60, 60 * 60 * 1000);
  if (!mutationRate.allowed) return NextResponse.json({ error: "Limite de alterações das bibliotecas atingido. Aguarde antes de tentar novamente." }, { status: 429, headers: { "Retry-After": String(mutationRate.retryAfterSeconds) } });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
  if (!id || !name) return NextResponse.json({ error: "Informe um nome válido para a biblioteca." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.from("influencer_libraries").update({ name, description: description || null }).eq("id", id).eq("user_id", user.id).select("id,name,description,created_at,updated_at").maybeSingle();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Já existe uma biblioteca com esse nome." }, { status: 409 });
    return NextResponse.json({ error: "Não foi possível atualizar a biblioteca." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Biblioteca não encontrada." }, { status: 404 });
  return NextResponse.json({ library: data });
}

export async function DELETE(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const mutationRate = rateLimit(getClientKey(request, user.id), 30, 60 * 60 * 1000);
  if (!mutationRate.allowed) return NextResponse.json({ error: "Limite de exclusões de biblioteca atingido. Aguarde antes de tentar novamente." }, { status: 429, headers: { "Retry-After": String(mutationRate.retryAfterSeconds) } });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Biblioteca inválida." }, { status: 400 });
  const admin = createAdminClient();
  const { data: library } = await admin.from("influencer_libraries").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!library) return NextResponse.json({ error: "Biblioteca não encontrada." }, { status: 404 });

  const { data: items } = await admin.from("influencer_content_items").select("id,r2_key").eq("library_id", id).eq("user_id", user.id);
  try {
    const keys = (items || []).map((item: any) => item.r2_key).filter((key: unknown): key is string => Boolean(key));
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET_NAME;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (keys.length && accountId && bucket && accessKeyId && secretAccessKey) {
      const { S3Client, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
      const client = new S3Client({ region: "auto", endpoint: "https://" + accountId + ".r2.cloudflarestorage.com", credentials: { accessKeyId, secretAccessKey } });
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
    }
  } catch (cleanupError) {
    console.warn("Influencer library R2 cleanup failed:", cleanupError);
  }

  if (items?.length) {
    const { error: itemsError } = await admin.from("influencer_content_items").delete().eq("user_id", user.id).eq("library_id", id);
    if (itemsError) return NextResponse.json({ error: "Não foi possível excluir os vídeos da biblioteca." }, { status: 500 });
  }
  const { error } = await admin.from("influencer_libraries").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Não foi possível excluir a biblioteca." }, { status: 500 });
  return NextResponse.json({ ok: true, deletedItems: items?.length || 0 });
}

export async function POST(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const mutationRate = rateLimit(getClientKey(request, user.id), 60, 60 * 60 * 1000);
  if (!mutationRate.allowed) {
    return NextResponse.json({ error: "Limite de alterações das bibliotecas atingido. Aguarde antes de tentar novamente." }, {
      status: 429, headers: { "Retry-After": String(mutationRate.retryAfterSeconds) }
    });
  }

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const admin = createAdminClient();

  if (action === "create") {
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
    if (!name) return NextResponse.json({ error: "Informe um nome para a biblioteca." }, { status: 400 });

    const { data, error } = await admin.from("influencer_libraries")
      .insert({ user_id: user.id, name, description: description || null })
      .select("id,name,description,created_at,updated_at")
      .single();

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Já existe uma biblioteca com esse nome." }, { status: 409 });
      return NextResponse.json({ error: "Não foi possível criar a biblioteca." }, { status: 500 });
    }
    return NextResponse.json({ library: data }, { status: 201 });
  }

  if (action === "link" || action === "unlink") {
    const libraryId = typeof body?.libraryId === "string" ? body.libraryId : "";
    const profileId = typeof body?.profileId === "string" ? body.profileId : "";
    if (!libraryId || !profileId) return NextResponse.json({ error: "Biblioteca ou perfil inválido." }, { status: 400 });

    const [{ data: library }, { data: profile }] = await Promise.all([
      admin.from("influencer_libraries").select("id").eq("id", libraryId).eq("user_id", user.id).maybeSingle(),
      admin.from("influencer_profiles").select("id").eq("id", profileId).eq("user_id", user.id).maybeSingle()
    ]);
    if (!library || !profile) return NextResponse.json({ error: "Biblioteca ou perfil não encontrado." }, { status: 404 });

    if (action === "unlink") {
      const { error } = await admin.from("influencer_profile_libraries")
        .delete().eq("library_id", libraryId).eq("profile_id", profileId).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: "Não foi possível desvincular a biblioteca." }, { status: 500 });
      return NextResponse.json({ ok: true, unlinked: true });
    }

    const { data: existing } = await admin.from("influencer_profile_libraries")
      .select("id").eq("library_id", libraryId).eq("profile_id", profileId).eq("user_id", user.id).maybeSingle();

    if (!existing) {
      const { data: priorities } = await admin.from("influencer_profile_libraries")
        .select("priority").eq("profile_id", profileId).eq("user_id", user.id);
      const priority = Math.max(-1, ...(priorities || []).map((row: any) => Number(row.priority) || 0)) + 1;
      const { error } = await admin.from("influencer_profile_libraries")
        .insert({ library_id: libraryId, profile_id: profileId, user_id: user.id, priority, enabled: true });
      if (error) return NextResponse.json({ error: "Não foi possível vincular a biblioteca." }, { status: 500 });
    } else {
      const { error } = await admin.from("influencer_profile_libraries")
        .update({ enabled: true }).eq("id", existing.id).eq("user_id", user.id);
      if (error) return NextResponse.json({ error: "Não foi possível ativar o vínculo da biblioteca." }, { status: 500 });
    }

    const { data: items } = await admin.from("influencer_content_items")
      .select("id,status").eq("library_id", libraryId).eq("user_id", user.id);
    if (items?.length) {
      const { data: existingStates } = await admin.from("influencer_profile_content")
        .select("item_id").eq("profile_id", profileId).eq("user_id", user.id).in("item_id", items.map((item: any) => item.id));
      const existingIds = new Set((existingStates || []).map((row: any) => row.item_id));
      const rows = items.filter((item: any) => !existingIds.has(item.id)).map((item: any) => ({
        profile_id: profileId,
        item_id: item.id,
        user_id: user.id,
        status: item.status === "processing" || item.status === "queued" ? "queued" : item.status === "failed" ? "failed" : "available",
        retry_count: 0
      }));
      if (rows.length) {
        const { error } = await admin.from("influencer_profile_content").insert(rows);
        if (error) return NextResponse.json({ error: "A biblioteca foi vinculada, mas não foi possível preparar todo o conteúdo para este perfil." }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, linked: true });
  }

  return NextResponse.json({ error: "Ação de biblioteca inválida." }, { status: 400 });
}
