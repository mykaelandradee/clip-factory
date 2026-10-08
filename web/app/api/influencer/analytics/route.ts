import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { decryptInstagramAccessToken, encryptInstagramAccessToken, refreshInstagramLongLivedToken } from "../../../../lib/instagram-auth";

export const runtime = "nodejs";

const API_VERSION = "v26.0";
const GRAPH = `https://graph.instagram.com/${API_VERSION}`;
const BASE_METRICS = "views,reach,likes,comments,saved,shares,total_interactions";
const OPTIONAL_METRICS = "follows,profile_visits";
const REEL_WATCH_METRICS = "ig_reels_avg_watch_time,ig_reels_video_view_total_time";
const MEDIA_LOOKUP_LIMIT = 100;
const MEDIA_MATCH_WINDOW_MS = 10 * 60 * 1000;

function metricValue(data:any[], name:string) {
  const row=(data||[]).find((entry:any)=>entry?.name===name);
  const value=row?.values?.[0]?.value ?? row?.total_value?.value ?? row?.value;
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}

async function auth() {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  return user;
}

export async function GET(request:Request) {
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});

  const url=new URL(request.url);
  const profileId=url.searchParams.get("profileId")||"";
  const sync=url.searchParams.get("sync")==="true";
  if(!profileId) return NextResponse.json({error:"Perfil inválido."},{status:400});

  const admin=createAdminClient();
  const {data:profile}=await admin.from("influencer_profiles")
    .select("id,name").eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});

  const {data:connection}=await admin.from("influencer_instagram_connections")
    .select("access_token_encrypted,expires_at,requires_reconnect")
    .eq("profile_id",profileId).eq("user_id",user.id).maybeSingle();

  if(!connection) return NextResponse.json({configured:false,metrics:[],message:"Conecte o Instagram deste perfil para coletar métricas."});
  if(connection.requires_reconnect) return NextResponse.json({configured:false,requiresReconnect:true,metrics:[],message:"Reconecte o Instagram deste perfil para coletar métricas."});

  let accessToken=decryptInstagramAccessToken(connection.access_token_encrypted);
  if(!accessToken) return NextResponse.json({configured:false,requiresReconnect:true,metrics:[],message:"Não foi possível ler a conexão do Instagram."});

  if(connection.expires_at && Date.parse(connection.expires_at)<Date.now()+7*24*60*60*1000){
    try{
      const refreshed=await refreshInstagramLongLivedToken(accessToken);
      accessToken=refreshed.accessToken;
      await admin.from("influencer_instagram_connections").update({
        access_token_encrypted:encryptInstagramAccessToken(accessToken),
        expires_at:refreshed.expiresIn>0?new Date(Date.now()+refreshed.expiresIn*1000).toISOString():connection.expires_at,
        requires_reconnect:false,last_refresh_error:null,updated_at:new Date().toISOString()
      }).eq("profile_id",profileId).eq("user_id",user.id);
    }catch(error){
      const message=error instanceof Error?error.message:"Não foi possível renovar o token do Instagram.";
      await admin.from("influencer_instagram_connections").update({requires_reconnect:true,last_refresh_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("profile_id",profileId).eq("user_id",user.id);
      return NextResponse.json({configured:false,requiresReconnect:true,metrics:[],message:"A conexão do Instagram precisa ser reconectada."});
    }
  }

  const {data:published,error:publishedError}=await admin.from("influencer_profile_content")
    .select("id,item_id,published_at,instagram_media_id")
    .eq("profile_id",profileId).eq("user_id",user.id).eq("status","published")
    .order("published_at",{ascending:false}).limit(30);
  if(publishedError) return NextResponse.json({error:"Não foi possível carregar os vídeos publicados."},{status:500});

  const itemIds=(published||[]).map((row:any)=>row.item_id);
  const {data:items}=itemIds.length
    ? await admin.from("influencer_content_items").select("id,title,category").in("id",itemIds).eq("user_id",user.id)
    : {data:[]};
  const itemById=new Map((items||[]).map((item:any)=>[item.id,item]));

  const syncDiagnostics: string[] = [];
  const publishedRows=published||[];

  // Publicações feitas antes da implementação de analytics não possuem o ID da mídia.
  // Recuperamos o Reel mais próximo pelo horário salvo após o media_publish.
  if(sync && publishedRows.some((row:any)=>!row.instagram_media_id)){
    try {
      const mediaUrl = GRAPH + "/me/media?fields=id,media_type,media_product_type,timestamp&limit=" + MEDIA_LOOKUP_LIMIT + "&access_token=" + encodeURIComponent(accessToken);
      const mediaResponse = await fetch(mediaUrl,{cache:"no-store"});
      const mediaPayload = await mediaResponse.json().catch(()=>({}));
      if(mediaResponse.ok && Array.isArray(mediaPayload?.data)){
        const candidates = mediaPayload.data.filter((media:any)=>
          String(media?.media_type||"").toUpperCase()==="VIDEO" || String(media?.media_product_type||"").toUpperCase()==="REELS"
        );
        for(const row of publishedRows.filter((value:any)=>!value.instagram_media_id)){
          const publishedAt=Date.parse(row.published_at||"");
          if(!Number.isFinite(publishedAt)) continue;
          let best:any=null;
          let bestDelta=Infinity;
          for(const media of candidates){
            const timestamp=Date.parse(media?.timestamp||"");
            if(!Number.isFinite(timestamp)) continue;
            const delta=Math.abs(timestamp-publishedAt);
            if(delta<bestDelta){best=media;bestDelta=delta;}
          }
          if(best?.id && bestDelta<=MEDIA_MATCH_WINDOW_MS){
            const {error:backfillError}=await admin.from("influencer_profile_content")
              .update({instagram_media_id:String(best.id),updated_at:new Date().toISOString()})
              .eq("id",row.id).eq("profile_id",profileId).eq("user_id",user.id);
            if(!backfillError) row.instagram_media_id=String(best.id);
          }
        }
      } else {
        syncDiagnostics.push(String(mediaPayload?.error?.message||"Não foi possível consultar as publicações do Instagram."));
      }
    } catch(error) {
      syncDiagnostics.push(error instanceof Error?error.message:"Falha ao localizar os Reels publicados no Instagram.");
    }
  }

  let insightSuccess=0;
  let insightErrors=0;

  if(sync && publishedRows.length){
    for(const row of publishedRows.slice(0,20)){
      const mediaId=String(row.instagram_media_id||"");
      if(!mediaId) continue;

      const response=await fetch(
        `${GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=${encodeURIComponent(BASE_METRICS)}&access_token=${encodeURIComponent(accessToken)}`,
        {cache:"no-store"}
      );
      const payload=await response.json().catch(()=>({}));
      if(!response.ok || !Array.isArray(payload?.data)){
        const code=payload?.error?.code!=null?` código ${payload.error.code}`:"";
        const message=String(payload?.error?.message||("Instagram Insights retornou HTTP "+response.status+"."));
        console.warn("Instagram media insights unavailable:",mediaId,{status:response.status,code:payload?.error?.code,message});
        syncDiagnostics.push(`Mídia ${mediaId}: ${message}${code}`);
        insightErrors++;
        continue;
      }

      let optionalData:any[]=[];
      try{
        const optionalResponse=await fetch(
          `${GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=${encodeURIComponent(OPTIONAL_METRICS)}&access_token=${encodeURIComponent(accessToken)}`,
          {cache:"no-store"}
        );
        const optionalPayload=await optionalResponse.json().catch(()=>({}));
        if(optionalResponse.ok && Array.isArray(optionalPayload?.data)) optionalData=optionalPayload.data;
      }catch{}

      let watchData:any[]=[];
      try{
        const watchResponse=await fetch(
          `${GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=${encodeURIComponent(REEL_WATCH_METRICS)}&access_token=${encodeURIComponent(accessToken)}`,
          {cache:"no-store"}
        );
        const watchPayload=await watchResponse.json().catch(()=>({}));
        if(watchResponse.ok && Array.isArray(watchPayload?.data)) watchData=watchPayload.data;
      }catch{}

      const {error:insertError}=await admin.from("influencer_media_insights").insert({
        user_id:user.id,profile_id:profileId,item_id:row.item_id,profile_content_id:row.id,
        instagram_media_id:mediaId,fetched_at:new Date().toISOString(),
        views:metricValue(payload.data,"views"),
        reach:metricValue(payload.data,"reach"),
        likes:metricValue(payload.data,"likes"),
        comments:metricValue(payload.data,"comments"),
        shares:metricValue(payload.data,"shares"),
        saves:metricValue(payload.data,"saved"),
        total_interactions:metricValue(payload.data,"total_interactions"),
        follows:metricValue(optionalData,"follows"),
        profile_visits:metricValue(optionalData,"profile_visits"),
        avg_watch_time_seconds:metricValue(watchData,"ig_reels_avg_watch_time"),
        total_watch_time_seconds:metricValue(watchData,"ig_reels_video_view_total_time"),
        raw_metrics:{base:payload.data,optional:optionalData,watch:watchData}
      });
      if(insertError){
        syncDiagnostics.push("Métrica encontrada, mas não foi salva no banco: "+insertError.message);
        insightErrors++;
      }else insightSuccess++;
    }
  }

  if(sync){
    const withIds=publishedRows.filter((row:any)=>row.instagram_media_id).length;
    syncDiagnostics.unshift(`Banco: ${publishedRows.length} publicações publicadas; ${withIds} com ID do Instagram.`);
    if(insightSuccess||insightErrors) syncDiagnostics.push(`Insights: ${insightSuccess} publicações sincronizadas; ${insightErrors} com erro.`);
    else if(publishedRows.length>0 && withIds===0) syncDiagnostics.push("Nenhuma publicação possui ID do Instagram para consultar Insights.");
  }

  const {data:snapshots,error:snapshotError}=await admin.from("influencer_media_insights")
    .select("*").eq("profile_id",profileId).eq("user_id",user.id)
    .order("fetched_at",{ascending:false}).limit(500);
  if(snapshotError) return NextResponse.json({error:"Não foi possível carregar as métricas salvas."},{status:500});

  const latestByMedia=new Map<string,any>();
  for(const row of snapshots||[]) if(!latestByMedia.has(row.instagram_media_id)) latestByMedia.set(row.instagram_media_id,row);

  const metrics=Array.from(latestByMedia.values()).map((row:any)=>({
    ...row,
    title:itemById.get(row.item_id)?.title||"Vídeo sem título",
    category:itemById.get(row.item_id)?.category||"OUTROS"
  }));

  const totals=metrics.reduce((acc:any,row:any)=>{
    for(const key of ["views","reach","likes","comments","shares","saves","total_interactions","follows","profile_visits"]){
      acc[key]=(acc[key]||0)+Number(row[key]||0);
    }
    return acc;
  },{views:0,reach:0,likes:0,comments:0,shares:0,saves:0,total_interactions:0,follows:0,profile_visits:0});

  const categoryTotals=Object.values(metrics.reduce((acc:any,row:any)=>{
    const key=String(row.category||"OUTROS");
    if(!acc[key])acc[key]={category:key,videos:0,views:0,shares:0,likes:0,comments:0,follows:0};
    acc[key].videos++;
    for(const metric of ["views","shares","likes","comments","follows"])acc[key][metric]+=Number(row[metric]||0);
    return acc;
  },{})).sort((a:any,b:any)=>Number(b.views)-Number(a.views));

  return NextResponse.json({
    configured:true,
    synced:sync,
    diagnostics:syncDiagnostics.slice(0,8),
    totals,
    categoryTotals,
    metrics
  },{headers:{"Cache-Control":"no-store"}});
}
