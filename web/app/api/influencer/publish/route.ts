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
const DESTINATION_TITLES={
  zh:["你可能不知道的一个瞬间","这个细节真的很有意思","一个值得注意的小事实","原来还有这样的事情"],
  ja:["意外と知らない瞬間","この細かい部分が面白い","知っておきたい小さな事実","実はこんなことがあります"],
} as const;
const DESTINATION_DESCRIPTIONS={
  zh:["你知道吗？很多看似普通的瞬间，其实都藏着一些有趣的细节。","有趣的是，人们往往只关注结果，却很少观察过程中的细节。","这个瞬间看起来很简单，但背后其实有一个值得注意的小事实。","生活里有很多意想不到的瞬间，它们总能让人停下来多看几秒。"],
  ja:["知っていますか？一見すると普通の瞬間でも、よく見ると意外と面白い細かな部分が隠れています。","面白いのは、人は結果ばかりに注目して途中の細かな動きを見落としやすいことです。","この瞬間はシンプルに見えますが、実はちょっとした豆知識につながるポイントがあります。","日常には予想していなかった瞬間がたくさんあります。少し視点を変えるだけで面白く見えることがあります。"],
} as const;
function destinationCopy(captionMode:string,itemId:string){
  const language=captionMode==="ja_random" ? "ja" : captionMode==="zh_random" ? "zh" : (itemId.charCodeAt(0)%2 ? "ja" : "zh");
  const titles=DESTINATION_TITLES[language], descriptions=DESTINATION_DESCRIPTIONS[language];
  const seed=[...itemId].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  return {title:titles[seed%titles.length],description:descriptions[(seed+1)%descriptions.length]};
}

function isRetryablePublishError(message:string) {
  const value=message.toLowerCase();
  return ![
    "conecte o instagram",
    "sessão do instagram expirou",
    "sessão do instagram está próxima de expirar",
    "não foi possível ler a conexão do instagram",
    "não foi possível descriptografar o token",
    "reel não está disponível",
  ].some((text)=>value.includes(text));
}

function retryDelayMinutes(retryCount:number) {
  return [5,15,30][Math.max(0,Math.min(2,retryCount-1))] || 30;
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


async function publishStoryOne(admin: ReturnType<typeof createAdminClient>, storyId: string) {
  const { data: story } = await admin.from("influencer_story_posts")
    .select("id,profile_id,user_id,item_id,reel_media_id,attempts,status")
    .eq("id",storyId).maybeSingle();
  if (!story || story.status !== "processing") return {status:"skipped"};

  const { data: profile } = await admin.from("influencer_profiles")
    .select("id,user_id,publishing_enabled")
    .eq("id",story.profile_id).eq("user_id",story.user_id).maybeSingle();
  if (!profile) {
    await admin.from("influencer_story_posts").update({status:"failed",error_message:"Perfil não encontrado.",updated_at:new Date().toISOString()}).eq("id",storyId);
    return {status:"error",error:"Perfil não encontrado."};
  }

  const { data: connection } = await admin.from("influencer_instagram_connections")
    .select("access_token_encrypted,expires_at,requires_reconnect").eq("profile_id",story.profile_id).eq("user_id",story.user_id).maybeSingle();
  if (!connection || connection.requires_reconnect) {
    const message="A conexão do Instagram precisa ser reconectada para publicar o Story.";
    await admin.from("influencer_story_posts").update({status:"failed",error_message:message,updated_at:new Date().toISOString()}).eq("id",storyId);
    return {status:"error",error:message};
  }

  let accessToken=decryptInstagramAccessToken(connection.access_token_encrypted);
  if (!accessToken) {
    await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:"Não foi possível descriptografar o token.",updated_at:new Date().toISOString()}).eq("profile_id",story.profile_id).eq("user_id",story.user_id);
    await admin.from("influencer_story_posts").update({status:"failed",error_message:"Não foi possível ler a conexão do Instagram.",updated_at:new Date().toISOString()}).eq("id",storyId);
    return {status:"error",error:"Não foi possível ler a conexão do Instagram."};
  }

  if (connection.expires_at && Date.parse(connection.expires_at) < Date.now()+7*24*60*60*1000) {
    try {
      const refreshed=await refreshInstagramLongLivedToken(accessToken);
      accessToken=refreshed.accessToken;
      await admin.from("influencer_instagram_connections").update({
        access_token_encrypted:encryptInstagramAccessToken(accessToken),
        expires_at:refreshed.expiresIn>0?new Date(Date.now()+refreshed.expiresIn*1000).toISOString():connection.expires_at,
        requires_reconnect:false,last_refresh_error:null,updated_at:new Date().toISOString()
      }).eq("profile_id",story.profile_id).eq("user_id",story.user_id);
    } catch(error) {
      const message=error instanceof Error?error.message:"Não foi possível renovar o token do Instagram.";
      await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("profile_id",story.profile_id).eq("user_id",story.user_id);
      await admin.from("influencer_story_posts").update({status:"failed",error_message:"A conexão do Instagram expirou ou não pode mais ser renovada.",updated_at:new Date().toISOString()}).eq("id",storyId);
      return {status:"error",error:message};
    }
  }

  const { data:item }=await admin.from("influencer_content_items").select("r2_key").eq("id",story.item_id).eq("user_id",story.user_id).maybeSingle();
  const publicUrl=(process.env.R2_PUBLIC_URL||"").replace(/\/$/,"");
  const videoUrl=item?.r2_key&&publicUrl?publicUrl+"/"+item.r2_key:"";
  if(!videoUrl) {
    const message="O vídeo processado não possui uma URL pública no R2.";
    await admin.from("influencer_story_posts").update({status:"failed",error_message:message,updated_at:new Date().toISOString()}).eq("id",storyId);
    return {status:"error",error:message};
  }

  try {
    const mediaParams=new URLSearchParams({media_type:"STORIES",video_url:videoUrl,access_token:accessToken});
    const containerResponse=await fetch(`${GRAPH}/me/media`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:mediaParams,cache:"no-store"});
    const containerData=await containerResponse.json().catch(()=>({}));
    if(!containerResponse.ok||!containerData.id) throw new Error(containerData?.error?.message||"O Instagram não conseguiu criar o Story.");

    const creationId=String(containerData.id);
    let statusCode="";
    for(let attempt=0;attempt<45;attempt++){
      await new Promise(r=>setTimeout(r,4000));
      const statusResponse=await fetch(`${GRAPH}/${encodeURIComponent(creationId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,{cache:"no-store"});
      const statusData=await statusResponse.json().catch(()=>({}));
      if(!statusResponse.ok) throw new Error(statusData?.error?.message||"Não foi possível consultar o processamento do Story.");
      statusCode=String(statusData.status_code||"");
      if(statusCode==="FINISHED") break;
      if(statusCode==="ERROR"||statusCode==="EXPIRED") throw new Error(String(statusData.status||"O Instagram rejeitou o Story."));
    }
    if(statusCode!=="FINISHED") throw new Error("O Instagram demorou demais para processar o Story.");

    const publishResponse=await fetch(`${GRAPH}/me/media_publish`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:creationId,access_token:accessToken}),cache:"no-store"});
    const publishData=await publishResponse.json().catch(()=>({}));
    if(!publishResponse.ok||!publishData.id) throw new Error(publishData?.error?.message||"O Instagram não conseguiu publicar o Story.");

    await admin.from("influencer_story_posts").update({
      status:"published",story_media_id:String(publishData.id),published_at:new Date().toISOString(),error_message:null,updated_at:new Date().toISOString()
    }).eq("id",storyId).eq("status","processing");
    return {status:"published",storyId,mediaId:String(publishData.id)};
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha na publicação do Story.";
    const tokenInvalid=/(invalid.*access token|access token.*invalid|oauth|token.*expired|session.*expired|(#190)|error code.*190)/i.test(message);
    if(tokenInvalid){
      await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("profile_id",story.profile_id).eq("user_id",story.user_id);
      await admin.from("influencer_profiles").update({publishing_enabled:false,updated_at:new Date().toISOString()}).eq("id",story.profile_id).eq("user_id",story.user_id);
    }
    await admin.from("influencer_story_posts").update({
      status:"failed",error_message:message.slice(0,1000),updated_at:new Date().toISOString()
    }).eq("id",storyId).eq("status","processing");
    return {status:"error",error:message};
  }
}


async function processDueStories(admin: ReturnType<typeof createAdminClient>) {
  const results: Array<{ storyId: string; status: string; error?: string }> = [];
  const now = new Date();

  const { data: dueStories } = await admin.from("influencer_story_posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(20);

  for (const story of dueStories || []) {
    const { data: claimedStory } = await admin.from("influencer_story_posts")
      .update({ status: "processing", attempts: 1, updated_at: new Date().toISOString() })
      .eq("id", story.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();

    if (!claimedStory) continue;

    const storyResult = await publishStoryOne(admin, story.id);
    results.push({ storyId: story.id, ...storyResult });
  }

  return results;
}

async function publishOne(admin: ReturnType<typeof createAdminClient>, profileId: string, userId: string, itemId?: string) {
  const { data: profile } = await admin.from("influencer_profiles")
    .select("id,user_id,posting_times,posts_per_day,next_publish_at,publishing_enabled,repeat_when_exhausted,cover_r2_key,share_to_feed,fixed_publish_title,fixed_publish_description,caption_mode,auto_story,story_delay_minutes")
    .eq("id",profileId).eq("user_id",userId).maybeSingle();
  if (!profile || (!itemId && !profile.publishing_enabled)) return { status:"stopped" };

  let item: any = null;
  let profileContent: any = null;

  const repeatWhenExhausted = Boolean((profile as any).repeat_when_exhausted);

  const {data:libraryLinks,error:libraryLinksError}=await admin.from("influencer_profile_libraries")
    .select("library_id,priority").eq("profile_id",profileId).eq("user_id",userId).eq("enabled",true)
    .order("priority",{ascending:true});
  if(libraryLinksError) return {status:"error",error:"Não foi possível carregar as bibliotecas deste perfil."};

  const libraryIds=(libraryLinks||[]).map((row:any)=>row.library_id).filter(Boolean);
  if(!libraryIds.length) return {status:"empty"};

  const {data:libraryItems}=await admin.from("influencer_content_items")
    .select("id,user_id,r2_key,publish_title,publish_description,status,scheduled_at,retry_count,created_at,published_at")
    .in("library_id",libraryIds).eq("user_id",userId)
    .in("status",["available","published"])
    .order("created_at",{ascending:true});

  const itemIds=(libraryItems||[]).map((row:any)=>row.id);
  const {data:states}=itemIds.length
    ? await admin.from("influencer_profile_content")
      .select("id,item_id,status,scheduled_at,published_at,error_message,retry_count,created_at")
      .eq("profile_id",profileId).eq("user_id",userId).in("item_id",itemIds)
    : {data:[]};
  const stateByItem=new Map((states||[]).map((row:any)=>[row.item_id,row]));

  // A content item can be available globally while each profile has its own
  // publication state. Reconcile legacy/processing states from the source item.
  for(const source of libraryItems||[]){
    const state=stateByItem.get(source.id);
    if(!state){
      const status=source.status==="published" ? "available" : source.status;
      const {data:created}=await admin.from("influencer_profile_content").insert({
        profile_id:profileId,item_id:source.id,user_id:userId,status,
        published_at:null,retry_count:0
      }).select("id,item_id,status,scheduled_at,published_at,error_message,retry_count").single();
      if(created) stateByItem.set(source.id,created);
    } else {
      // Repara um estado "published" impossível: a publicação não pode ter
      // ocorrido antes da própria criação do vídeo. Mantém publicações válidas.
      const publishedAt=state.published_at ? Date.parse(state.published_at) : NaN;
      const createdAt=Date.parse(source.created_at||"");
      const stalePublished=state.status==="published" &&
        Number.isFinite(publishedAt) && Number.isFinite(createdAt) &&
        publishedAt < createdAt;
      const nextStatus=stalePublished
        ? "available"
        : (["processing","queued"].includes(state.status) && ["available","published"].includes(source.status))
          ? "available"
          : state.status;
      if(nextStatus!==state.status){
        const patch:any={status:nextStatus,updated_at:new Date().toISOString()};
        if(nextStatus==="available") patch.scheduled_at=null;
        const {data:updated}=await admin.from("influencer_profile_content")
          .update(patch)
          .eq("id",state.id).eq("user_id",userId)
          .select("id,item_id,status,scheduled_at,published_at,error_message,retry_count").single();
        if(updated) stateByItem.set(source.id,updated);
      }
    }
  }

  // "scheduled" é uma reserva ativa feita antes da publicação no Instagram.
  // Nunca devemos ignorar essa reserva e escolher outro vídeo para o mesmo perfil:
  // isso faria o scheduler publicar um Reel diferente enquanto o primeiro continua
  // em processamento. Uma reserva recente tem prioridade absoluta.
  const reservedCandidates=(libraryItems||[])
    .map((source:any)=>({source,state:stateByItem.get(source.id)}))
    .filter((entry:any)=>entry.state && entry.state.status==="scheduled")
    .sort((a:any,b:any)=>
      String(a.state.scheduled_at||"").localeCompare(String(b.state.scheduled_at||""))
    );

  const candidates=(libraryItems||[])
    .map((source:any)=>({source,state:stateByItem.get(source.id)}))
    .filter((entry:any)=>entry.state && ["available","published"].includes(entry.state.status))
    .sort((a:any,b:any)=>{
      const pa=(a.state.status==="available"?0:1)-(b.state.status==="available"?0:1);
      return pa || String(a.source.created_at||"").localeCompare(String(b.source.created_at||""));
    });

  let chosen:any = null;
  if(itemId){
    // Publicação manual de um item específico continua tendo prioridade.
    chosen=reservedCandidates.find((entry:any)=>entry.source.id===itemId)?.source.id
      ? reservedCandidates.find((entry:any)=>entry.source.id===itemId)
      : candidates.find((entry:any)=>entry.source.id===itemId) || null;
  } else {
    // Se já existe uma reserva para este perfil, retomamos exatamente esse Reel.
    chosen=reservedCandidates[0] || null;

    if(!chosen){
      chosen=candidates.find((entry:any)=>entry.state.status==="available") || null;
      if(!chosen && repeatWhenExhausted) {
        const publishedCandidates=candidates.filter((entry:any)=>entry.state.status==="published");
        chosen=publishedCandidates.sort((a:any,b:any)=>
          String(a.state.published_at||a.source.published_at||a.source.created_at||"").localeCompare(
            String(b.state.published_at||b.source.published_at||b.source.created_at||"")
          )
        )[0] || null;
      }
    }
  }

  if(chosen){
    item=chosen.source;
    profileContent=chosen.state;
  }

  if (!item) {
    if (!itemId && !repeatWhenExhausted) {
      await admin.from("influencer_profiles").update({publishing_enabled:false,next_publish_at:null,updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    }
    return { status:"empty" };
  }

  const { data: connection } = await admin.from("influencer_instagram_connections")
     .select("access_token_encrypted,expires_at,requires_reconnect,last_refresh_error").eq("profile_id",profileId).eq("user_id",userId).maybeSingle();
  if (!connection) return { status:"error", error:"Conecte o Instagram deste perfil antes de executar a publicação.", tokenNeedsReconnect:true };
  if (connection.requires_reconnect) return { status:"error", error:"A conexão do Instagram precisa ser reconectada para continuar as publicações.", tokenNeedsReconnect:true };

  let accessToken = decryptInstagramAccessToken(connection.access_token_encrypted);
  if (!accessToken) {
    await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:"Não foi possível descriptografar o token.",updated_at:new Date().toISOString()}).eq("profile_id",profileId).eq("user_id",userId);
    return { status:"error", error:"Não foi possível ler a conexão do Instagram. Conecte novamente.", tokenNeedsReconnect:true };
  }

  if (connection.expires_at && Date.parse(connection.expires_at) < Date.now()+7*24*60*60*1000) {
    try {
      const refreshed = await refreshInstagramLongLivedToken(accessToken);
      accessToken = refreshed.accessToken;
      await admin.from("influencer_instagram_connections").update({
        access_token_encrypted:encryptInstagramAccessToken(accessToken),
        expires_at: refreshed.expiresIn > 0 ? new Date(Date.now()+refreshed.expiresIn*1000).toISOString() : connection.expires_at,
        requires_reconnect:false,
        last_refresh_error:null,
        updated_at:new Date().toISOString()
      }).eq("profile_id",profileId).eq("user_id",userId);
    } catch(error) {
      const message=error instanceof Error?error.message:"Não foi possível renovar o token do Instagram.";
      await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("profile_id",profileId).eq("user_id",userId);
      await admin.from("influencer_profiles").update({publishing_enabled:false,updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
      return { status:"error", error:"A conexão do Instagram expirou ou não pode mais ser renovada. Reconecte o Instagram deste perfil.", tokenNeedsReconnect:true };
    }
  }

  const publicUrl = (process.env.R2_PUBLIC_URL || "").replace(/\/$/,"");
  const videoUrl = item.r2_key && publicUrl ? `${publicUrl}/${item.r2_key}` : "";
  if (!videoUrl) return { status:"error", error:"O vídeo processado não possui uma URL pública no R2." };

  const mediaCheck = await fetch(videoUrl,{method:"HEAD",cache:"no-store"});
  if (!mediaCheck.ok || !(mediaCheck.headers.get("content-type")||"").toLowerCase().startsWith("video/")) {
    return { status:"error", error:"O Reel processado não está acessível no R2." };
  }

  const originalStatus=profileContent?.status || "available";
  const isExistingReservation = originalStatus === "scheduled";
  const claimTime=new Date().toISOString();

  // Uma reserva "scheduled" já foi criada por outro ciclo do scheduler.
  // Nesse caso, não tentamos reivindicá-la novamente: devemos retomar exatamente
  // o mesmo Reel. Para estados novos, mantemos a proteção atômica contra concorrência.
  if(!isExistingReservation){
    const claimableStatuses = (itemId && originalStatus === "published") || (repeatWhenExhausted && originalStatus === "published") ? ["published"] : ["available"];
    const {data:claimed}=await admin.from("influencer_profile_content")
      .update({status:"scheduled",scheduled_at:claimTime,error_message:null,updated_at:claimTime})
      .eq("id",profileContent.id).eq("user_id",userId).in("status",claimableStatuses)
      .select("id").maybeSingle();
    if(!claimed) return {status:"busy",itemId:item.id,error:"Este Reel já está em processamento ou foi publicado por outro processo."};
  }

  try {
    const fixedTitle = String(profile.fixed_publish_title || "").trim();
    const fixedDescription = String(profile.fixed_publish_description || "").trim();
    const captionParts = [
      fixedTitle || String(item.publish_title || "").trim(),
      fixedDescription || String(item.publish_description || "").trim()
    ].filter(Boolean);
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
    await admin.from("influencer_profile_content").update({
      status:"published",published_at:new Date().toISOString(),scheduled_at:null,error_message:null,retry_count:0,updated_at:new Date().toISOString()
    }).eq("id",profileContent.id).eq("user_id",userId);
    await admin.from("influencer_profiles").update({next_publish_at:next.toISOString(),updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    return {status:"published",itemId:item.id,mediaId:String(publishData.id),nextPublishAt:next.toISOString()};
  } catch(error) {
    const message=error instanceof Error?error.message:"Falha na publicação.";
    const tokenInvalid=/(invalid.*access token|access token.*invalid|oauth|token.*expired|session.*expired|(#190)|error code.*190)/i.test(message);
    if (tokenInvalid) {
      await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("profile_id",profileId).eq("user_id",userId);
      await admin.from("influencer_profiles").update({publishing_enabled:false,updated_at:new Date().toISOString()}).eq("id",profileId).eq("user_id",userId);
    }
    const retryable=tokenInvalid ? false : isRetryablePublishError(message);
    const retryCount=Number(profileContent?.retry_count)||0;
    const nextRetryCount=retryCount+1;
    const exhausted=nextRetryCount>=3;
    const wasRepeatedPublished = repeatWhenExhausted && originalStatus === "published";
    await admin.from("influencer_profile_content").update({
      status:exhausted ? "failed" : (wasRepeatedPublished ? "published" : "available"),
      scheduled_at:null,
      error_message:message.slice(0,1000),
      retry_count:nextRetryCount,
      updated_at:new Date().toISOString()
    }).eq("id",profileContent.id).eq("user_id",userId);
    return {status:"error",error:message,retryable,retryCount:nextRetryCount,exhausted};
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
    const {data:activeProfiles}=await admin.from("influencer_profiles")
      .select("id,user_id,next_publish_at,posting_times,posts_per_day")
      .eq("auto_publish",true)
      .eq("publishing_enabled",true)
      .limit(100);

    // Corrige agendas antigas que ficaram apontando para um horário posterior
    // enquanto ainda existe um horário configurado anterior no mesmo dia.
    for(const profile of activeProfiles||[]){
      const expected=nextSlot((profile as any).posting_times||[],now,Number((profile as any).posts_per_day)||3);
      const stored=profile.next_publish_at ? new Date(profile.next_publish_at) : null;
      if(!stored || stored.getTime()>expected.getTime()){
        await admin.from("influencer_profiles")
          .update({next_publish_at:expected.toISOString(),updated_at:new Date().toISOString()})
          .eq("id",profile.id)
          .eq("user_id",profile.user_id)
          .eq("auto_publish",true)
          .eq("publishing_enabled",true);
      }
    }

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
        const {data:retryProfile}=await admin.from("influencer_profiles")
          .select("posting_times,posts_per_day,publish_retry_count")
          .eq("id",p.id).eq("user_id",p.user_id).maybeSingle();
        const retryCount=Number((retryProfile as any)?.publish_retry_count)||0;
        const nextRetryCount=retryCount+1;
        const retryable=(result as any).retryable!==false;
        const exhausted=(result as any).exhausted===true || nextRetryCount>=3;
        const next=retryable && !exhausted
          ? new Date(Date.now()+retryDelayMinutes(nextRetryCount)*60*1000)
          : nextSlot((retryProfile as any)?.posting_times||[],new Date(),Number((retryProfile as any)?.posts_per_day)||3);
        await admin.from("influencer_profiles").update({
          next_publish_at:next.toISOString(),
          publish_retry_count:exhausted?0:nextRetryCount,
          updated_at:new Date().toISOString()
        }).eq("id",p.id).eq("user_id",p.user_id).eq("auto_publish",true).eq("publishing_enabled",true);
      } else if(result.status==="published"){
        await admin.from("influencer_profiles").update({
          publish_retry_count:0,
          updated_at:new Date().toISOString()
        }).eq("id",p.id).eq("user_id",p.user_id);
      }
      results.push({profileId:p.id,userId:p.user_id,...result});
    }

    const storyResults = await processDueStories(admin);
    results.push(...storyResults);

    return NextResponse.json({ok:true,results},{headers:{"Cache-Control":"no-store"}});
  }

  if(action==="process-stories"){
    if(!isScheduler) return NextResponse.json({error:"Não autorizado."},{status:401});
    const results = await processDueStories(admin);
    return NextResponse.json({ok:true,processed:results.length,results},{headers:{"Cache-Control":"no-store"}});
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
