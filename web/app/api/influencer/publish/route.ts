import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { decryptInstagramAccessToken, encryptInstagramAccessToken, refreshInstagramLongLivedToken } from "../../../../lib/instagram-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const API_VERSION = "v25.0";
const GRAPH = `https://graph.instagram.com/${API_VERSION}`;

function schedulerAuthorized(request: Request) {
  const secret = process.env.CLIP_FACTORY_SCHEDULER_TOKEN || "";
  const supplied = request.headers.get("x-clip-factory-scheduler-token") || "";
  if (!secret || supplied.length !== secret.length) return false;
  try { return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret)); } catch { return false; }
}

function localParts(date:Date) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Cuiaba",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value||0);
  return {year:get("year"),month:get("month"),day:get("day"),hour:get("hour"),minute:get("minute")};
}
function localToUtc(year:number,month:number,day:number,hour:number,minute:number) {
  let guess=Date.UTC(year,month-1,day,hour,minute,0,0);
  for(let i=0;i<3;i++){
    const p=localParts(new Date(guess));
    const rendered=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,0,0);
    const desired=Date.UTC(year,month-1,day,hour,minute,0,0);
    guess += desired-rendered;
  }
  return new Date(guess);
}
function nextSlot(times:string[], from=new Date(), postsPerDay=3) {
  const valid=times.filter(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)).sort();
  if(!valid.length){
    const fallback=["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"].slice(0,Math.max(1,Math.min(9,postsPerDay)));
    valid.push(...fallback);
  }
  const local=localParts(from);
  const base=Date.UTC(local.year,local.month-1,local.day);
  for(const value of valid){
    const [h,m]=value.split(":").map(Number);
    const candidate=localToUtc(local.year,local.month,local.day,h,m);
    if(candidate.getTime()>from.getTime())return candidate;
  }
  const first=valid[0].split(":").map(Number);
  const tomorrow=new Date(base+24*60*60*1000);
  const y=tomorrow.getUTCFullYear(), mo=tomorrow.getUTCMonth()+1, d=tomorrow.getUTCDate();
  return localToUtc(y,mo,d,first[0],first[1]);
}

async function publishOne(admin: ReturnType<typeof createAdminClient>, profileId: string, userId: string, itemId?: string) {
  const { data: profile } = await admin.from("influencer_profiles")
    .select("id,user_id,posting_times,posts_per_day,next_publish_at,publishing_enabled,cover_r2_key,share_to_feed,fixed_publish_title,fixed_publish_description")
    .eq("id",profileId).eq("user_id",userId).maybeSingle();
  if (!profile || (!itemId && !profile.publishing_enabled)) return { status:"stopped" };

  let item: any = null;
  let shareId: string | null = null;

  const ownQuery = admin.from("influencer_content_items")
    .select("id,profile_id,user_id,r2_key,publish_title,publish_description,status,scheduled_at")
    .eq("profile_id",profileId).eq("user_id",userId).in("status",["available"]);
  const own = await (itemId ? ownQuery.eq("id",itemId) : ownQuery.order("created_at",{ascending:true}).limit(1)).maybeSingle();
  if (own.data) item = own.data;

  if (!item) {
    const shareQuery = admin.from("influencer_content_shares")
      .select("id,item_id,profile_id,status,scheduled_at")
      .eq("profile_id",profileId).eq("user_id",userId).in("status",itemId?["available","published"]:["available"]);
    const shareResult = await (itemId ? shareQuery.eq("item_id",itemId) : shareQuery.order("created_at",{ascending:true}).limit(1)).maybeSingle();
    if (shareResult.data) {
      shareId = shareResult.data.id;
      const { data: source } = await admin.from("influencer_content_items")
        .select("id,profile_id,user_id,r2_key,publish_title,publish_description,status,scheduled_at")
        .eq("id",shareResult.data.item_id).eq("user_id",userId).maybeSingle();
      if (source) item = source;
    }
  }

  if (!item) {
    if (!itemId) await admin.from("influencer_profiles").update({publishing_enabled:false,next_publish_at:null,updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    return { status:"empty" };
  }

  const { data: connection } = await admin.from("influencer_instagram_connections")
    .select("access_token_encrypted,expires_at").eq("profile_id",profileId).eq("user_id",userId).maybeSingle();
  if (!connection) return { status:"error", error:"Conecte o Instagram deste perfil antes de executar a publicação." };

  let accessToken = decryptInstagramAccessToken(connection.access_token_encrypted);
  if (!accessToken) return { status:"error", error:"Não foi possível ler a conexão do Instagram. Conecte novamente." };

  if (connection.expires_at && Date.parse(connection.expires_at) < Date.now()+7*24*60*60*1000) {
    try {
      const refreshed = await refreshInstagramLongLivedToken(accessToken);
      accessToken = refreshed.accessToken;
      await admin.from("influencer_instagram_connections").update({
        access_token_encrypted:encryptInstagramAccessToken(accessToken),
        expires_at: refreshed.expiresIn > 0 ? new Date(Date.now()+refreshed.expiresIn*1000).toISOString() : connection.expires_at,
        updated_at:new Date().toISOString()
      }).eq("profile_id",profileId).eq("user_id",userId);
    } catch { return { status:"error", error:"A sessão do Instagram expirou. Conecte novamente." }; }
  }

  const publicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/$/,"");
  const videoUrl = item.r2_key && publicUrl ? `${publicUrl}/${item.r2_key}` : "";
  if (!videoUrl) return { status:"error", error:"O vídeo processado não possui uma URL pública no R2." };

  const mediaCheck = await fetch(videoUrl,{method:"HEAD",cache:"no-store"});
  if (!mediaCheck.ok || !(mediaCheck.headers.get("content-type")||"").toLowerCase().startsWith("video/")) {
    return { status:"error", error:"O Reel processado não está acessível no R2." };
  }

  const originalStatus=item.status;
  const claimTime=new Date().toISOString();
  let claimedItem=false;
  if (shareId) {
    const {data:claimed}=await admin.from("influencer_content_shares")
      .update({status:"scheduled",scheduled_at:claimTime,error_message:null})
      .eq("id",shareId).eq("user_id",userId).eq("status","available")
      .select("id").maybeSingle();
    claimedItem=Boolean(claimed);
  } else {
    const {data:claimed}=await admin.from("influencer_content_items")
      .update({status:"scheduled",scheduled_at:claimTime,updated_at:claimTime,error_message:null})
      .eq("id",item.id).eq("user_id",userId).eq("status","available")
      .select("id").maybeSingle();
    claimedItem=Boolean(claimed);
  }
  if (!claimedItem) return {status:"busy",itemId:item.id,error:"Este Reel já está em processamento ou foi publicado por outro processo."};

  try {
    const fixedTitle = String(profile.fixed_publish_title || "").trim();
    const fixedDescription = String(profile.fixed_publish_description || "").trim();
    const captionParts = [fixedTitle || String(item.publish_title || "").trim(), fixedDescription || String(item.publish_description || "").trim()].filter(Boolean);
    const caption = captionParts.join("\n\n") || "✨";
    let coverUrl = "";
    if (profile.cover_r2_key) {
      const { data: signedCover } = await admin.storage.from("influencer-covers").createSignedUrl(profile.cover_r2_key, 3600);
      coverUrl = signedCover?.signedUrl || "";
    }
    const mediaParams = new URLSearchParams({ media_type:"REELS", video_url:videoUrl, caption, share_to_feed:profile.share_to_feed !== false ? "true" : "false", access_token:accessToken });
    if (coverUrl) mediaParams.set("cover_url", coverUrl);
    const containerResponse = await fetch(`${GRAPH}/me/media`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:mediaParams,cache:"no-store"});
    const containerData = await containerResponse.json().catch(()=>({}));
    if(!containerResponse.ok || !containerData.id) throw new Error(containerData?.error?.message || "O Instagram não conseguiu criar o Reel.");

    const creationId=String(containerData.id);
    let statusCode="";
    for(let attempt=0;attempt<45;attempt++){
      await new Promise(r=>setTimeout(r,4000));
      const statusResponse=await fetch(`${GRAPH}/${encodeURIComponent(creationId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,{cache:"no-store"});
      const statusData=await statusResponse.json().catch(()=>({}));
      if(!statusResponse.ok) throw new Error(statusData?.error?.message || "Não foi possível consultar o processamento do Reel.");
      statusCode=String(statusData.status_code||"");
      if(statusCode==="FINISHED") break;
      if(statusCode==="ERROR"||statusCode==="EXPIRED") throw new Error(String(statusData.status||"O Instagram rejeitou o Reel."));
    }
    if(statusCode!=="FINISHED") throw new Error("O Instagram demorou demais para processar o Reel.");

    const publishResponse=await fetch(`${GRAPH}/me/media_publish`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:creationId,access_token:accessToken}),cache:"no-store"});
    const publishData=await publishResponse.json().catch(()=>({}));
    if(!publishResponse.ok || !publishData.id) throw new Error(publishData?.error?.message || "O Instagram não conseguiu publicar o Reel.");

    const next=nextSlot((profile.posting_times||[]) as string[],new Date(),Number(profile.posts_per_day)||3);
    if (shareId) await admin.from("influencer_content_shares").update({status:"published",published_at:new Date().toISOString(),scheduled_at:null,error_message:null}).eq("id",shareId).eq("user_id",userId);
    else await admin.from("influencer_content_items").update({status:"published",published_at:new Date().toISOString(),scheduled_at:null,error_message:null,updated_at:new Date().toISOString()}).eq("id",item.id).eq("user_id",userId);
    await admin.from("influencer_profiles").update({next_publish_at:next.toISOString(),updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    return {status:"published",itemId:item.id,mediaId:String(publishData.id),nextPublishAt:next.toISOString()};
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha na publicação.";
    if (shareId) await admin.from("influencer_content_shares").update({status:"available",scheduled_at:null,error_message:message.slice(0,1000)}).eq("id",shareId).eq("user_id",userId);
    else await admin.from("influencer_content_items").update({status:originalStatus==="published"?"published":"available",scheduled_at:null,error_message:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("id",item.id).eq("user_id",userId);
    return {status:"error",error:message};
  }
}

export async function POST(request:Request) {
  const isScheduler=schedulerAuthorized(request);
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user && !isScheduler) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});

  const body=await request.json().catch(()=>({}));
  const action=typeof body?.action==="string"?body.action:"start";
  const profileId=typeof body?.profileId==="string"?body.profileId:"";
  const admin=createAdminClient();

  if(isScheduler){
    const results=[];
    const now=new Date();
    const claimUntil=new Date(now.getTime()+10*60*1000).toISOString();
    const {data:dueProfiles}=await admin.from("influencer_profiles")
      .select("id,user_id,next_publish_at")
      .eq("auto_publish",true)
      .eq("publishing_enabled",true)
      .lte("next_publish_at",now.toISOString())
      .order("next_publish_at",{ascending:true})
      .limit(20);

    for(const p of dueProfiles||[]){
      // Atomically claim the profile before doing the long Instagram upload.
      // This prevents Supabase Cron and GitHub Actions from publishing the same Reel concurrently.
      const {data:claimed}=await admin.from("influencer_profiles")
        .update({next_publish_at:claimUntil,updated_at:new Date().toISOString()})
        .eq("id",p.id)
        .eq("user_id",p.user_id)
        .eq("auto_publish",true)
        .eq("publishing_enabled",true)
        .lte("next_publish_at",now.toISOString())
        .select("id,user_id")
        .maybeSingle();

      if(!claimed) continue;

      const result=await publishOne(admin,p.id,p.user_id);
      if(result.status==="error"){
        // Release the claim with a short retry delay after a failed publication.
        await admin.from("influencer_profiles").update({
          next_publish_at:new Date(Date.now()+5*60*1000).toISOString(),
          updated_at:new Date().toISOString()
        }).eq("id",p.id).eq("user_id",p.user_id).eq("auto_publish",true).eq("publishing_enabled",true);
      }
      results.push({profileId:p.id,userId:p.user_id,...result});
    }

    return NextResponse.json({ok:true,results},{headers:{"Cache-Control":"no-store"}});
  }

  if(!profileId) return NextResponse.json({error:"Perfil inválido."},{status:400});
  const userId=user!.id;
  const {data:profile}=await admin.from("influencer_profiles").select("id").eq("id",profileId).eq("user_id",userId).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});

  if(action==="publish-item"){
    const itemId=typeof body?.itemId==="string"?body.itemId:"";
    if(!itemId) return NextResponse.json({error:"Reel inválido."},{status:400});
    const result=await publishOne(admin,profileId,userId,itemId);
    if(result.status==="error") return NextResponse.json({ok:false,...result},{status:502});
    if(result.status==="busy") return NextResponse.json({ok:false,...result},{status:409});
    if(result.status!=="published") return NextResponse.json({ok:false,error:"Este Reel não está disponível para publicação."},{status:409});
    return NextResponse.json({ok:true,...result});
  }

  if(action==="enable-auto"){
    const profileSchedule=(await admin.from("influencer_profiles").select("posting_times,posts_per_day").eq("id",profileId).eq("user_id",userId).single()).data;
    const next = nextSlot((profileSchedule?.posting_times || []) as string[],new Date(),Number(profileSchedule?.posts_per_day)||3);
    await admin.from("influencer_profiles").update({auto_publish:true,publishing_enabled:true,next_publish_at:next.toISOString(),updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    return NextResponse.json({ok:true,publishingEnabled:true,nextPublishAt:next.toISOString()});
  }

  if(action==="stop"){
    await admin.from("influencer_profiles").update({publishing_enabled:false,next_publish_at:null,updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    return NextResponse.json({ok:true,publishingEnabled:false});
  }

  await admin.from("influencer_profiles").update({auto_publish:true,publishing_enabled:true,next_publish_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
  const result=await publishOne(admin,profileId,userId);
  if(result.status==="error") return NextResponse.json({ok:false,publishingEnabled:true,...result},{status:502});
  return NextResponse.json({ok:true,publishingEnabled:true,...result});
}

export async function GET(request:Request) { return POST(request); }
