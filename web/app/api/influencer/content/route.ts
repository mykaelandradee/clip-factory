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

  const items = data || [];
  const processing = items.filter((item) => item.status === "processing" && item.clip_job_id);
  if (processing.length) {
    const cookie = request.headers.get("cookie") || "";
    const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
    await Promise.all(processing.map(async (item) => {
      try {
        const statusResponse = await fetch(
          `${origin}/api/jobs?id=${encodeURIComponent(String(item.clip_job_id))}`,
          { headers: cookie ? { cookie } : undefined, cache: "no-store" },
        );
        const status = await statusResponse.json().catch(() => ({}));
        if (statusResponse.ok && status.status === "completed" && status.result?.files?.[0]?.url) {
          await admin.from("influencer_content_items").update({
            status: "available",
            result_url: status.result.files[0].url,
            error_message: null,
            updated_at: new Date().toISOString(),
          }).eq("id", item.id).eq("user_id", user.id);
          item.status = "available";
          item.result_url = status.result.files[0].url;
        } else if (statusResponse.ok && ["failed", "canceled"].includes(status.status)) {
          await admin.from("influencer_content_items").update({
            status: "failed",
            error_message: status.error || status.message || "O processamento falhou.",
            updated_at: new Date().toISOString(),
          }).eq("id", item.id).eq("user_id", user.id);
          item.status = "failed";
          item.error_message = status.error || status.message || "O processamento falhou.";
        }
      } catch (syncError) {
        console.warn("Influencer content job sync failed:", syncError);
      }
    }));
  }

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const profileId = typeof body?.profileId === "string" ? body.profileId : "";
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  let title = typeof body?.title === "string" ? body.title.trim().slice(0, 500) : "";
  if (!profileId || !sourceUrl || sourceUrl.length > 2048) return NextResponse.json({ error: "Informe o perfil e a URL do vídeo." }, { status: 400 });
  let parsed: URL;
  try { parsed = new URL(sourceUrl); } catch { return NextResponse.json({ error: "URL inválida." }, { status: 400 }); }
  if (parsed.protocol !== "https:") return NextResponse.json({ error: "A URL precisa usar HTTPS." }, { status: 400 });
  if (!title) {
    try {
      const oembed = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`, { cache: "no-store" });
      if (oembed.ok) {
        const metadata = await oembed.json().catch(() => ({}));
        if (typeof metadata?.title === "string") title = metadata.title.trim().slice(0, 500);
      }
    } catch {
      // O título original é opcional; o processamento continua mesmo se o oEmbed não responder.
    }
  }
  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles").select("id").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
  const { data: item, error } = await admin.from("influencer_content_items").insert({
    profile_id: profileId, user_id: user.id, source_url: sourceUrl, title: title || null, source_type: "url", status: "queued"
  }).select("*").single();
  if (error) return NextResponse.json({ error: "Não foi possível adicionar o vídeo à biblioteca." }, { status: 500 });

  try {
    const cookie = request.headers.get("cookie") || "";
    const origin = new URL(request.url).origin;
    const jobResponse = await fetch(new URL("/api/jobs", request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        "x-clip-factory-internal": "influencer-manager",
      },
      body: JSON.stringify({
        url: sourceUrl,
        source_title: title || undefined,
        count: 1,
        min_duration: 5,
        max_duration: 60,
        subtitle_language: "original",
        caption_style: "karaoke",
      }),
      cache: "no-store",
    });
    const jobData = await jobResponse.json().catch(() => ({}));
    if (!jobResponse.ok || !jobData.jobId) {
      await admin.from("influencer_content_items").update({
        status: "failed",
        error_message: jobData.error || "Não foi possível iniciar o processamento.",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id).eq("user_id", user.id);
      return NextResponse.json({ error: jobData.error || "Não foi possível iniciar o processamento do vídeo." }, { status: 502 });
    }

    const { data: updatedItem, error: updateError } = await admin.from("influencer_content_items").update({
      status: "processing",
      clip_job_id: jobData.jobId,
      updated_at: new Date().toISOString(),
    }).eq("id", item.id).eq("user_id", user.id).select("*").single();
    if (updateError) throw updateError;
    return NextResponse.json({ item: updatedItem }, { status: 202 });
  } catch (processingError) {
    await admin.from("influencer_content_items").update({
      status: "failed",
      error_message: processingError instanceof Error ? processingError.message : "Erro ao iniciar processamento.",
      updated_at: new Date().toISOString(),
    }).eq("id", item.id).eq("user_id", user.id);
    return NextResponse.json({ error: processingError instanceof Error && processingError.message ? `Vídeo adicionado, mas não foi possível iniciar o processamento: ${processingError.message}` : "Vídeo adicionado, mas não foi possível iniciar o processamento." }, { status: 502 });
  }
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
