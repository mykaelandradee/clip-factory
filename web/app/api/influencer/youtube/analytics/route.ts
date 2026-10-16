import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "../../../../../lib/youtube-auth";
import { getVideoStatistics, getYouTubeAccessToken, YouTubeError } from "../../../../../lib/youtube-upload";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

/**
 * Métricas dos Shorts publicados por um perfil do YouTube.
 * Mesmo formato de resposta do Analytics do Instagram, para a tela reutilizar
 * a mesma estrutura. Os números vêm ao vivo da API do YouTube (baratos: 1
 * unidade de cota a cada 50 vídeos), então não há tabela de histórico.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401, headers: noStore });

  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return NextResponse.json({ error: "Perfil inválido." }, { status: 400, headers: noStore });

  const admin = createAdminClient();
  const { data: profile } = await admin.from("influencer_profiles")
    .select("id,platform").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404, headers: noStore });
  if (profile.platform !== "youtube") return NextResponse.json({ error: "Este perfil não é do YouTube." }, { status: 400, headers: noStore });

  // Cada envio ao YouTube é um vídeo próprio, inclusive quando a biblioteca se repete.
  const { data: posts, error: postsError } = await admin.from("influencer_youtube_posts")
    .select("id,item_id,youtube_video_id,title,published_at")
    .eq("profile_id", profileId).eq("user_id", user.id).eq("status", "published")
    .not("youtube_video_id", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false }).limit(200);
  if (postsError) return NextResponse.json({ error: "Não foi possível carregar os Shorts publicados." }, { status: 500, headers: noStore });
  const published = posts || [];

  const itemIds = [...new Set(published.map((post: any) => post.item_id).filter(Boolean))];
  const { data: items } = itemIds.length
    ? await admin.from("influencer_content_items").select("id,title,category").in("id", itemIds).eq("user_id", user.id)
    : { data: [] };
  const itemById = new Map((items || []).map((item: any) => [item.id, item]));

  const diagnostics: string[] = [];
  let stats = new Map<string, { views: number | null; likes: number | null; comments: number | null }>();
  const { data: connection } = await admin.from("influencer_youtube_connections")
    .select("refresh_token_encrypted,requires_reconnect").eq("profile_id", profileId).eq("user_id", user.id).maybeSingle();

  if (!connection) diagnostics.push("Conecte o canal do YouTube deste perfil para coletar métricas.");
  else if (connection.requires_reconnect) diagnostics.push("Reconecte o canal do YouTube deste perfil para coletar métricas.");
  else if (published.length) {
    const refreshToken = decryptYouTubeRefreshToken(connection.refresh_token_encrypted);
    if (!refreshToken) diagnostics.push("Não foi possível ler a conexão do YouTube. Reconecte o canal.");
    else {
      try {
        const accessToken = await getYouTubeAccessToken(refreshToken);
        stats = await getVideoStatistics(accessToken, published.map((post: any) => String(post.youtube_video_id)));
        const missing = published.filter((post: any) => !stats.has(String(post.youtube_video_id))).length;
        if (missing) diagnostics.push(`${missing} Short(s) não encontrado(s) no YouTube — podem ter sido removidos do canal.`);
      } catch (error) {
        const message = error instanceof YouTubeError || error instanceof Error ? error.message : "Falha ao consultar o YouTube.";
        if (error instanceof YouTubeError && error.kind === "auth") {
          await admin.from("influencer_youtube_connections")
            .update({ requires_reconnect: true, last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
            .eq("profile_id", profileId).eq("user_id", user.id);
        }
        console.warn("Influencer YouTube analytics failed:", message);
        diagnostics.push(message);
      }
    }
  }

  const publishedReels = published.map((post: any) => {
    const item: any = itemById.get(post.item_id);
    const s = stats.get(String(post.youtube_video_id));
    return {
      id: post.id, item_id: post.item_id, youtube_video_id: post.youtube_video_id,
      title: item?.title || post.title || "Vídeo sem título", category: item?.category || "OUTROS",
      published_at: post.published_at, hasMetrics: Boolean(s), fetched_at: s ? new Date().toISOString() : null,
      views: s?.views ?? null, likes: s?.likes ?? null, comments: s?.comments ?? null,
      reach: null, shares: null, saves: null, follows: null,
    };
  });
  const metrics = publishedReels.filter((row) => row.hasMetrics);

  const totals = metrics.reduce((acc: any, row: any) => {
    for (const key of ["views", "likes", "comments"]) acc[key] += Number(row[key] || 0);
    return acc;
  }, { views: 0, likes: 0, comments: 0, shares: 0, follows: 0 });

  const categoryTotals = Object.values(publishedReels.reduce((acc: any, row: any) => {
    const key = String(row.category || "OUTROS");
    if (!acc[key]) acc[key] = { category: key, videos: 0, withMetrics: 0, views: 0, likes: 0, comments: 0, shares: 0 };
    acc[key].videos++;
    if (row.hasMetrics) acc[key].withMetrics++;
    for (const metric of ["views", "likes", "comments"]) acc[key][metric] += Number(row[metric] || 0);
    return acc;
  }, {})).sort((a: any, b: any) => Number(b.views) - Number(a.views));

  return NextResponse.json({
    configured: Boolean(connection && !connection.requires_reconnect),
    diagnostics: diagnostics.slice(0, 5),
    totals,
    categoryTotals,
    publishedReels,
    metrics,
    metricCoverage: { follows: 0, reach: 0, views: metrics.length },
    publishedSummary: { total: published.length, withInstagramId: published.length, withMetrics: metrics.length },
  }, { headers: noStore });
}
