import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre no Clip Factory." }, { status: 401 });

  const admin = createAdminClient();
  const { data: profiles } = await admin
    .from("influencer_profiles")
    .select("id,name,instagram_username")
    .eq("user_id", user.id);
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

  const { data: own, error } = await admin
    .from("influencer_content_items")
    .select("id,profile_id,title,publish_title,publish_description,r2_key,result_url,status,scheduled_at,published_at,error_message,created_at")
    .eq("user_id", user.id)
    .in("status", ["scheduled","published","failed"])
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });

  if (error) return NextResponse.json({ error: "Não foi possível carregar a grade do Influencer Manager." }, { status: 500 });

  const { data: shares } = await admin
    .from("influencer_content_shares")
    .select("id,item_id,profile_id,status,scheduled_at,published_at,error_message,created_at")
    .eq("user_id", user.id)
    .in("status", ["scheduled","published","failed"])
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });

  const ids = (shares || []).map((s: any) => s.item_id);
  let sourceItems: any[] = [];
  if (ids.length) {
    const { data } = await admin.from("influencer_content_items")
      .select("id,title,publish_title,publish_description,r2_key,result_url")
      .in("id", ids)
      .eq("user_id", user.id);
    sourceItems = data || [];
  }
  const sourceMap = new Map(sourceItems.map((i: any) => [i.id, i]));

  const rows = [
    ...(own || []).map((item: any) => {
      const profile = profileMap.get(item.profile_id);
      return {
        id: item.id,
        profileId: item.profile_id,
        profileName: profile?.name || "Influencer Manager",
        username: profile?.instagram_username || null,
        platform: "instagram",
        title: item.publish_title || item.title || "Reel do Influencer Manager",
        file: item.r2_key ? item.r2_key.split("/").pop() : "reel.mp4",
        scheduledAt: item.scheduled_at,
        status: item.status,
        lastError: item.error_message || null,
        resultUrl: item.result_url || null,
      };
    }),
    ...(shares || []).map((share: any) => {
      const item = sourceMap.get(share.item_id);
      const profile = profileMap.get(share.profile_id);
      if (!item) return null;
      return {
        id: share.id,
        profileId: share.profile_id,
        profileName: profile?.name || "Influencer Manager",
        username: profile?.instagram_username || null,
        platform: "instagram",
        title: item.publish_title || item.title || "Reel do Influencer Manager",
        file: item.r2_key ? item.r2_key.split("/").pop() : "reel.mp4",
        scheduledAt: share.scheduled_at,
        status: share.status,
        lastError: share.error_message || null,
        resultUrl: item.result_url || null,
      };
    }).filter(Boolean),
  ].sort((a: any, b: any) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return NextResponse.json({ scheduledPosts: rows }, { headers: { "Cache-Control": "no-store" } });
}
