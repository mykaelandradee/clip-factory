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
function nextSlot(times:string[], from=new Date()) {
  const valid=times.filter(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)).sort();
  if(!valid.length)return new Date(from.getTime()+5*60*1000);
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
    .select("id,user_id,posting_times,next_publish_at,publishing_enabled,cover_r2_key")
    .eq("id",profileId).eq("user_id",userId).maybeSingle();
  if (!profile || (!itemId && !profile.publishing_enabled)) return { status:"stopped" };

  let itemQuery = admin.from("influencer_content_items")
    .select("id,profile_id,user_id,r2_key,publish_title,publish_description,status")
    .eq("profile_id",profileId).eq("user_id",userId).in("status",itemId?["available","published"]:["available"]);
  if (itemId) itemQuery = itemQuery.eq("id", itemId);
  const { data: item } = await itemQuery.order("created_at",{ascending:true}).limit(1).maybeSingle();
  if (!item) {
    if (!itemId) {
      await admin.from("influencer_profiles").update({publishing_enabled:false,next_publish_at:null,updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    }
    return { status:"empty" };
  }

  const { data: connection } = await admin.from("influencer_instagram_connections")
    .select("access_token_encrypted,expires_at").eq("profile_id",profileId).eq("user_id",userId).maybeSingle();
  if (!connection) return { status:"error", error:"Conecte o Instagram deste perfil antes de executar a publicação." };

  let accessToken = decryptInstagramAccessToken(connection.access_token_encrypted);
  if (!accessToken) return { status:"error", error:"Não foi possível ler a conexão do Instagram. Conecte novamente." };

  if (connection.expires_at && Date.parse(connection.expires_at) <= Date.now()) {
    try {
      const refreshed = await refreshInstagramLongLivedToken(accessToken);
      accessToken = refreshed.accessToken;
      await admin.from("influencer_instagram_connections").update({
        access_token_encrypted: encryptInstagramAccessToken(accessToken),
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
  await admin.from("influencer_content_items").update({status:"scheduled",scheduled_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",item.id);

  try {
    const caption = (item.publish_description || "").trim() || "✨";
    let coverUrl = "";
    if (profile.cover_r2_key) {
      const { data: signedCover } = await admin.storage.from("influencer-covers").createSignedUrl(profile.cover_r2_key, 3600);
      coverUrl = signedCover?.signedUrl || "";
    }
    const mediaParams = new URLSearchParams({ media_type:"REELS", video_url:videoUrl, caption, share_to_feed:"false", access_token:accessToken });
    if (coverUrl) mediaParams.set("cover_url", coverUrl);
    const containerResponse = await fetch(`${GRAPH}/me/media`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:mediaParams,
      cache:"no-store"
    });
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

    const publishResponse=await fetch(`${GRAPH}/me/media_publish`,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({creation_id:creationId,access_token:accessToken}),
      cache:"no-store"
    });
    const publishData=await publishResponse.json().catch(()=>({}));
    if(!publishResponse.ok || !publishData.id) throw new Error(publishData?.error?.message || "O Instagram não conseguiu publicar o Reel.");

    const next=nextSlot((profile.posting_times||[]) as string[]);
    await admin.from("influencer_content_items").update({
      status:"published",published_at:new Date().toISOString(),scheduled_at:null,error_message:null,updated_at:new Date().toISOString()
    }).eq("id",item.id);
    if (!itemId || profile.publishing_enabled) {
      await admin.from("influencer_profiles").update({next_publish_at:next.toISOString(),updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    }
    return {status:"published",itemId:item.id,mediaId:String(publishData.id),nextPublishAt:next.toISOString()};
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha na publicação.";
    await admin.from("influencer_content_items").update({status:originalStatus==="published"?"published":"available",scheduled_at:null,error_message:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("id",item.id);
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
    const {data:profiles}=await admin.from("influencer_profiles").select("id,user_id,next_publish_at").eq("auto_publish",true).eq("publishing_enabled",true).lte("next_publish_at",new Date().toISOString()).limit(20);
    const results=[];
    for(const p of profiles||[]) results.push({profileId:p.id,userId:p.user_id,...await publishOne(admin,p.id,p.user_id)});
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
    if(result.status!=="published") return NextResponse.json({ok:false,error:"Este Reel não está disponível para publicação."},{status:409});
    return NextResponse.json({ok:true,...result});
  }

  if(action==="enable-auto"){
    const next = nextSlot((await admin.from("influencer_profiles").select("posting_times").eq("id",profileId).single()).data?.posting_times || []);
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
