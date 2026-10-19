import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { parseManifest, type ProcessingManifest } from "../../../../../lib/influencer-processing";
import { deleteItemFolder, itemFolder } from "../../../../../lib/r2-storage";

export const runtime="nodejs";
const GITHUB_API="https://api.github.com", OWNER="mykaelandradee", REPO="clip-factory", WORKFLOW="influencer-manager-worker.yml";

function headers(){const token=process.env.CLIP_FACTORY_GITHUB_TOKEN;if(!token)throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado.");return {Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28"};}

function instagramFallbackTitle(sourceUrl:string){
  try{
    const url=new URL(sourceUrl);
    const host=url.hostname.toLowerCase().replace(/^www\./,"");
    if(host!=="instagram.com" && !host.endsWith(".instagram.com")) return null;
    const match=url.pathname.match(/^\/(?:reel|reels|p)\/([^/?#]+)/i);
    return match?.[1] ? `Instagram Reel · ${match[1]}` : "Instagram Reel";
  }catch{return null;}
}

async function fetchSourceMetadata(sourceUrl:string):Promise<{title:string|null,description:string|null}>{
  try{
    const response=await fetch(sourceUrl,{cache:"no-store",headers:{"User-Agent":"Mozilla/5.0 ClipFactory/1.0"}});
    if(!response.ok)return {title:null,description:null};
    const html=(await response.text()).slice(0,2_000_000);
    const clean=(value:string)=>value.replace(/&quot;/g,'\"').replace(/&#39;/g,"'").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();
    const titleMatch=html.match(/<meta[^>]+(?:property|name)=[\"']og:title[\"'][^>]+content=[\"']([^\"']*)[\"']/i)
      || html.match(/<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']og:title[\"']/i)
      || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descriptionMatch=html.match(/<meta[^>]+(?:name|property)=[\"'](?:description|og:description)[\"'][^>]+content=[\"']([^\"']*)[\"']/i)
      || html.match(/<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:name|property)=[\"'](?:description|og:description)[\"']/i);
    return {
      title:titleMatch?.[1] ? clean(titleMatch[1]).slice(0,500) || null : null,
      description:descriptionMatch?.[1] ? clean(descriptionMatch[1]).slice(0,5000) || null : null
    };
  }catch{return {title:null,description:null}}
}

async function syncLinkedProfileQueue(admin:any,userId:string,item:any){
  if(!item.library_id || item.status!=="available") return;
  const {data:links,error:linksError}=await admin.from("influencer_profile_libraries")
    .select("profile_id").eq("library_id",item.library_id).eq("user_id",userId).eq("enabled",true);
  if(linksError){console.error("Não foi possível localizar perfis vinculados ao sincronizar o vídeo:",linksError);return;}
  for(const link of links||[]){
    const {data:existingState,error:stateLookupError}=await admin.from("influencer_profile_content")
      .select("id,status").eq("profile_id",link.profile_id).eq("item_id",item.id).eq("user_id",userId).maybeSingle();
    if(stateLookupError){console.error("Não foi possível consultar o estado do vídeo na fila:",stateLookupError);continue;}
    if(!existingState){
      const {error:insertError}=await admin.from("influencer_profile_content").insert({
        profile_id:link.profile_id,item_id:item.id,user_id:userId,status:"available",retry_count:0
      });
      if(insertError) console.error("Não foi possível inserir o vídeo na fila do perfil:",insertError);
    }else if(["queued","processing"].includes(existingState.status)){
      const {error:updateError}=await admin.from("influencer_profile_content")
        .update({status:"available",scheduled_at:null,error_message:null,updated_at:new Date().toISOString()})
        .eq("id",existingState.id).eq("user_id",userId);
      if(updateError) console.error("Não foi possível liberar o vídeo na fila do perfil:",updateError);
    }
  }
}

export async function GET(request:Request){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
 const id=new URL(request.url).searchParams.get("id")||"";if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"Conteúdo inválido."},{status:400});
 const admin=createAdminClient();const {data:item,error}=await admin.from("influencer_content_items").select("*").eq("id",id).eq("user_id",user.id).maybeSingle();
 if(error||!item)return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});
 if(item.status!=="processing"){if(item.status==="available")await syncLinkedProfileQueue(admin,user.id,item);return NextResponse.json({item},{headers:{"Cache-Control":"no-store"}});
 }
 try{
  const response=await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=repository_dispatch&per_page=30`,{headers:headers(),cache:"no-store"});
  if(!response.ok)throw new Error("Não foi possível consultar o Influencer Manager Worker.");
  const data=await response.json();
  const run=(data.workflow_runs||[]).find((r:any)=>r.display_title===`Influencer Manager ${id}`||r.run_name===`Influencer Manager ${id}`);
  if(!run)return NextResponse.json({item:{...item,progress:5,stage:"queued"}},{headers:{"Cache-Control":"no-store"}});
  let active="";
  try{
   const jr=await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=10`,{headers:headers(),cache:"no-store"});
   if(jr.ok){const jd=await jr.json();const job=(jd.jobs||[])[0];active=String((job?.steps||[]).find((s:any)=>s.status==="in_progress")?.name||"");}
  }catch{}
  const low=active.toLowerCase();
  let progress=20,stage=active||"processing";
  if(low.includes("process")){progress=50;stage="processing";}
  else if(low.includes("download")){progress=35;stage="download";}
  else if(low.includes("upload")){progress=78;stage="upload";}
  else if(low.includes("python")||low.includes("deno")||low.includes("youtube")){progress=20;stage="worker_setup";}
  if(run.status==="completed"){
   if(run.conclusion==="success"){
    const publicUrl=process.env.R2_PUBLIC_URL?.replace(/\/$/,"")||"";
    const prefix=`influencer/${user.id}/libraries/${item.library_id}/${item.id}`;
    // O worker grava um manifesto com os vídeos gerados (1 no modo Original ou
    // Legendado; N no modo Cortes). Sem manifesto (worker antigo), vale o
    // caminho histórico de um único vídeo.
    let manifest:ProcessingManifest|null=null;
    if(publicUrl){
      try{
        const manifestResponse=await fetch(`${publicUrl}/${prefix}/manifest.json?t=${Date.now()}`,{cache:"no-store"});
        if(manifestResponse.ok) manifest=parseManifest(await manifestResponse.json(),prefix);
      }catch(manifestError){console.warn("Influencer manifest unavailable:",manifestError);}
    }
    const outputs=manifest?.outputs?.length ? manifest.outputs : [{index:1,key:item.r2_key||`${prefix}/video.mp4`,start:0,end:0,duration:0,transcript:"",title:""}];
    const isClips=manifest?.mode==="clips";
    const first=outputs[0];
    const sourceMetadata = manifest?.source_title ? {title:manifest.source_title,description:manifest.source_description||null} : await fetchSourceMetadata(item.source_url);
    const sourceDescription = item.source_description || sourceMetadata.description;
    const sourceTitle = item.title || sourceMetadata.title || instagramFallbackTitle(item.source_url);
    // O título público continua sendo o do vídeo de origem; a numeração do
    // corte aparece só na biblioteca (clip_index/clip_count).
    const clipTitle=(_index:number)=>sourceTitle;
    const now=new Date().toISOString();
    const updated:any={
      status:"available",progress:100,stage:"ready",r2_key:first.key,result_url:publicUrl?`${publicUrl}/${first.key}`:item.result_url,
      title:clipTitle(1),source_description:sourceDescription,
      duration_seconds:first.duration||manifest?.source_duration||item.duration_seconds||null,
      transcript:(isClips?first.transcript:manifest?.transcript)||null,
      error_message:null,updated_at:now,
    };
    if(isClips) Object.assign(updated,{group_id:item.id,clip_index:1,clip_count:outputs.length,clip_start:first.start,clip_end:first.end});
    // Conclusão atômica: só quem muda o item de "processing" para "available"
    // cria os cortes, para que consultas simultâneas não os dupliquem.
    const {data:done}=await admin.from("influencer_content_items").update(updated)
      .eq("id",id).eq("user_id",user.id).eq("status","processing").select("*").maybeSingle();
    if(!done){
      const {data:current}=await admin.from("influencer_content_items").select("*").eq("id",id).eq("user_id",user.id).maybeSingle();
      return NextResponse.json({item:current||item},{headers:{"Cache-Control":"no-store"}});
    }
    await syncLinkedProfileQueue(admin,user.id,done);

    let createdClips=0;
    for(const output of outputs.slice(1)){
      const {data:clip,error:clipError}=await admin.from("influencer_content_items").insert({
        library_id:item.library_id,user_id:user.id,source_url:item.source_url,source_type:item.source_type||"url",
        title:clipTitle(output.index),category:item.category||"OUTROS",
        status:"available",progress:100,stage:"ready",r2_key:output.key,result_url:publicUrl?`${publicUrl}/${output.key}`:null,
        duration_seconds:output.duration||null,source_description:sourceDescription,
        processing_mode:"clips",caption_style:manifest?.caption_style||item.caption_style||null,
        subtitle_language:manifest?.subtitle_language||item.subtitle_language||null,
        group_id:item.id,clip_index:output.index,clip_count:outputs.length,clip_start:output.start,clip_end:output.end,
        transcript:output.transcript||null,
        // Sem texto salvo: na publicação, cada perfil usa o próprio texto ou gera o automático.
        publish_title:null,publish_description:null,
      }).select("*").single();
      if(clipError){console.error("Influencer clip item creation failed:",clipError.message);continue;}
      createdClips++;
      await syncLinkedProfileQueue(admin,user.id,clip);
    }

    return NextResponse.json({item:done,createdClips},{headers:{"Cache-Control":"no-store"}});
   }
   // O worker grava o motivo da falha (cookies vencidos, vídeo privado, vídeo
   // longo demais para o modo...) em error.json; sem ele, mensagem genérica.
   let failureMessage=run.conclusion==="cancelled"?"Processamento cancelado.":"O Influencer Manager Worker terminou com erro.";
   const failurePublicUrl=process.env.R2_PUBLIC_URL?.replace(/\/$/,"")||"";
   const failureFolder=itemFolder(user.id,item.library_id,item.id);
   if(run.conclusion!=="cancelled"&&failurePublicUrl){
     try{
       const errorResponse=await fetch(`${failurePublicUrl}/${failureFolder}/error.json?t=${Date.now()}`,{cache:"no-store"});
       if(errorResponse.ok){
         const reason=await errorResponse.json().catch(()=>null);
         if(typeof reason?.message==="string"&&reason.message.trim()) failureMessage=reason.message.trim().slice(0,500);
       }
     }catch{}
   }
   const failedItem={...item,status:"failed",progress,stage:"error",error_message:failureMessage,updated_at:new Date().toISOString()};

   // Falhas não devem permanecer na biblioteca como se fossem vídeos utilizáveis.
   // Apaga a pasta inteira do item no R2 (inclui cortes já enviados antes da
   // falha), o estado da fila e o próprio item. O motivo volta para a tela.
   try{
     await deleteItemFolder(failureFolder);
   }catch(cleanupError){
     console.warn("Influencer failed-item R2 cleanup failed:",cleanupError);
   }

   const {error:stateCleanupError}=await admin.from("influencer_profile_content")
     .delete().eq("item_id",id).eq("user_id",user.id);
   if(stateCleanupError) console.warn("Influencer failed-item queue cleanup failed:",stateCleanupError);

   const {error:itemCleanupError}=await admin.from("influencer_content_items")
     .delete().eq("id",id).eq("user_id",user.id);
   if(itemCleanupError){
     console.warn("Influencer failed-item cleanup failed:",itemCleanupError);
     return NextResponse.json({item:failedItem,removed:false},{headers:{"Cache-Control":"no-store"}});
   }

   return NextResponse.json({item:failedItem,removed:true},{headers:{"Cache-Control":"no-store"}});
  }
  if(!item.worker_run_id){await admin.from("influencer_content_items").update({worker_run_id:run.id,progress,stage,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id);}
  else await admin.from("influencer_content_items").update({progress,stage,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id);
  return NextResponse.json({item:{...item,worker_run_id:run.id,progress,stage}},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({item,error:error instanceof Error?error.message:"Erro ao consultar worker."},{headers:{"Cache-Control":"no-store"}});}
}