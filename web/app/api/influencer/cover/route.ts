import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const COVER_BUCKET = "influencer-covers";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const form = await request.formData();
  const profileId = String(form.get("profileId") || "");
  const file = form.get("file");
  if (!profileId || !(file instanceof File)) return NextResponse.json({ error: "Selecione uma imagem de capa." }, { status: 400 });
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "Use JPG, PNG ou WEBP." }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "A capa deve ter no máximo 5 MB." }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("influencer_profiles")
    .select("id,cover_r2_key")
    .eq("id", profileId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `influencer/${user.id}/${profileId}/cover-${Date.now()}.${ext}`;
  const body = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(COVER_BUCKET)
    .upload(path, body, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) {
    console.error("Influencer cover Supabase Storage upload failed:", {
      message: uploadError.message,
      bucket: COVER_BUCKET,
      path,
    });
    return NextResponse.json({
      error: "Não foi possível enviar a capa para o armazenamento do Supabase.",
      code: uploadError.message,
      hint: "Confirme no Supabase se o bucket influencer-covers existe. Ele pode ser privado; o Clip Factory acessa a imagem pelo servidor.",
    }, { status: 502 });
  }

  if (profile.cover_r2_key && profile.cover_r2_key !== path) {
    const { error: removeError } = await admin.storage
      .from(COVER_BUCKET)
      .remove([profile.cover_r2_key]);
    if (removeError) console.warn("Could not remove previous influencer cover:", removeError.message);
  }

  const { data: updated, error } = await admin
    .from("influencer_profiles")
    .update({
      cover_r2_key: path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    await admin.storage.from(COVER_BUCKET).remove([path]);
    return NextResponse.json({ error: "A capa foi enviada, mas não foi possível salvar o perfil." }, { status: 500 });
  }

  return NextResponse.json({ profile: updated });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Entre no Clip Factory.", { status: 401 });

  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return new NextResponse("Perfil inválido.", { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("influencer_profiles")
    .select("cover_r2_key")
    .eq("id", profileId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile?.cover_r2_key) return new NextResponse("Capa não configurada.", { status: 404 });

  const { data: object, error } = await admin.storage
    .from(COVER_BUCKET)
    .download(profile.cover_r2_key);

  if (error || !object) return new NextResponse("Capa não encontrada.", { status: 404 });

  return new NextResponse(await object.arrayBuffer(), {
    headers: {
      "Content-Type": object.type || "image/jpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
