import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../../lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IG_APP_ID = "936619743392459";
const MAX_RESULTS = 50;

async function auth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function extractUsername(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    const username = parts[0].replace(/^@/, "");
    return /^[a-zA-Z0-9._]{1,30}$/.test(username) ? username : null;
  } catch {
    return null;
  }
}

function firstCaption(node: any) {
  const edges = node?.edge_media_to_caption?.edges || node?.edge_media_to_caption?.edges || [];
  return typeof edges[0]?.node?.text === "string" ? edges[0].node.text.trim() : "";
}

function thumbnail(node: any) {
  if (typeof node?.display_url === "string") return node.display_url;
  if (typeof node?.thumbnail_src === "string") return node.thumbnail_src;
  const resources = Array.isArray(node?.display_resources) ? node.display_resources : [];
  return typeof resources.at(-1)?.src === "string" ? resources.at(-1).src : null;
}

function isReel(node: any) {
  return Boolean(node?.is_video || node?.product_type === "clips" || node?.__typename === "GraphVideo");
}

function normalizeNode(edge: any) {
  const node = edge?.node || {};
  const shortcode = typeof node.shortcode === "string" ? node.shortcode : "";
  if (!shortcode || !isReel(node)) return null;

  const caption = firstCaption(node);
  return {
    id: String(node.id || shortcode),
    shortcode,
    url: `https://www.instagram.com/reel/${shortcode}/`,
    thumbnail: thumbnail(node),
    title: caption ? caption.slice(0, 180) : `Instagram Reel · ${shortcode}`,
    caption,
    publishedAt: typeof node.taken_at_timestamp === "number"
      ? new Date(node.taken_at_timestamp * 1000).toISOString()
      : null,
  };
}

async function fetchProfile(username: string) {
  const encoded = encodeURIComponent(username);
  const urls = [
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encoded}`,
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encoded}`,
  ];

  let lastStatus = 0;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "X-IG-App-ID": IG_APP_ID,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      lastStatus = response.status;
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      const user = data?.data?.user;
      if (user) return { user, status: response.status };
    } catch {
      // Try the second public endpoint before returning a controlled error.
    }
  }

  throw new Error(
    lastStatus === 429
      ? "O Instagram limitou temporariamente a consulta desse perfil. Aguarde alguns minutos e tente novamente."
      : "Não foi possível consultar esse perfil do Instagram agora. O perfil precisa ser público e acessível sem login."
  );
}

export async function GET(request: Request) {
  const user = await auth();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const limiter = rateLimit(getClientKey(request, user.id), 12, 10 * 60 * 1000);
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: `Muitas consultas. Tente novamente em cerca de ${limiter.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } }
    );
  }

  const profileUrl = new URL(request.url).searchParams.get("url") || "";
  const username = extractUsername(profileUrl);
  if (!username) {
    return NextResponse.json(
      { error: "Cole a URL de um perfil público do Instagram, por exemplo https://www.instagram.com/usuario/" },
      { status: 400 }
    );
  }

  try {
    const { user: instagramUser } = await fetchProfile(username);
    if (instagramUser?.is_private) {
      return NextResponse.json({ error: "Este perfil é privado. Apenas perfis públicos podem ser importados." }, { status: 400 });
    }

    const connection =
      instagramUser?.edge_felix_video_timeline?.edges?.length
        ? instagramUser.edge_felix_video_timeline
        : instagramUser.edge_owner_to_timeline_media;

    const candidates = Array.isArray(connection?.edges) ? connection.edges : [];
    const reels = candidates
      .map(normalizeNode)
      .filter(Boolean)
      .slice(0, MAX_RESULTS);

    const admin = createAdminClient();
    const urls = reels.map((item: any) => item.url);
    const normalizedUrls = urls.map((value: string) => {
      try {
        const url = new URL(value);
        return `instagram:${url.pathname.replace(/\\/+$/, "").toLowerCase()}`;
      } catch {
        return "";
      }
    }).filter(Boolean);

    const { data: existing } = normalizedUrls.length
      ? await admin
          .from("influencer_content_items")
          .select("source_url")
          .eq("user_id", user.id)
          .eq("source_type", "instagram")
      : { data: [] };

    const existingKeys = new Set(
      (existing || []).map((item: any) => {
        try {
          const url = new URL(item.source_url);
          return `instagram:${url.pathname.replace(/\\/+$/, "").toLowerCase()}`;
        } catch {
          return "";
        }
      })
    );

    const normalized = reels.map((item: any) => ({
      ...item,
      duplicate: existingKeys.has(
        `instagram:${new URL(item.url).pathname.replace(/\\/+$/, "").toLowerCase()}`
      ),
    }));

    return NextResponse.json({
      profile: {
        username,
        name: instagramUser.full_name || instagramUser.username || username,
        avatar: instagramUser.profile_pic_url || instagramUser.profile_pic_url_hd || null,
        isVerified: Boolean(instagramUser.is_verified),
        isPrivate: Boolean(instagramUser.is_private),
      },
      reels: normalized,
      totalFound: normalized.length,
      hasMore: Boolean(connection?.page_info?.has_next_page),
      note: connection?.page_info?.has_next_page
        ? "Foram exibidos os primeiros Reels disponíveis nesta consulta."
        : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível listar os Reels." },
      { status: 502 }
    );
  }
}
