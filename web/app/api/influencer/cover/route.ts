import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const form = await request.formData();
  const profileId = String(form.get("profileId") || "");
  const file = form.get("file");
  if (!profileId || !(file instanceof File)) return NextResponse.json({ error: "Selecione uma imagem de capa." }, { status: 400 });
  if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return NextResponse.json({ error: "Use JPG, PNG ou WEBP." }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "A capa deve ter no máximo 5 MB." }, { status: 400 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles").select("id,cover_r2_key").eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return NextResponse.json({ error: "Armazenamento R2 não configurado." }, { status: 503 });

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `influencer/${user.id}/${profileId}/cover-${Date.now()}.${ext}`;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  if (profile.cover_r2_key && profile.cover_r2_key !== key) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: profile.cover_r2_key }));
    } catch (cleanupError) {
      console.warn("Could not remove previous influencer cover:", cleanupError);
    }
  }

  const { data: updated, error } = await admin.from("influencer_profiles").update({
    cover_r2_key: key,
    updated_at: new Date().toISOString(),
  }).eq("id",profileId).eq("user_id",user.id).select("*").single();

  if (error) return NextResponse.json({ error: "A capa foi enviada, mas não foi possível salvar o perfil." }, { status: 500 });
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

  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    return new NextResponse("Armazenamento R2 não configurado.", { status: 503 });
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: profile.cover_r2_key }));
    if (!object.Body) return new NextResponse("Capa não encontrada.", { status: 404 });
    const bytes = await object.Body.transformToByteArray();
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": object.ContentType || "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Capa não encontrada.", { status: 404 });
  }
}
