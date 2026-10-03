import { NextResponse } from "next/server";
import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const runtime="nodejs";
const GITHUB_API="https://api.github.com", OWNER="mykaelandradee", REPO="clip-factory", WORKFLOW="influencer-manager-worker.yml";

function headers(){const token=process.env.CLIP_FACTORY_GITHUB_TOKEN;if(!token)throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado.");return {Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28"};}

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

export async function GET(request:Request){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
 const id=new URL(request.url).searchParams.get("id")||"";if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"Conteúdo inválido."},{status:400});
 const admin=createAdminClient();const {data:item,error}=await admin.from("influencer_content_items").select("*").eq("id",id).eq("user_id",user.id).maybeSingle();
 if(error||!item)return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});
 if(item.status!=="processing")return NextResponse.json({item},{headers:{"Cache-Control":"no-store"}});
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
  if(low.includes("download")){progress=35;stage="download";}
  else if(low.includes("upload")){progress=78;stage="upload";}
  else if(low.includes("python")||low.includes("deno")||low.includes("youtube")){progress=20;stage="worker_setup";}
  if(run.status==="completed"){
   if(run.conclusion==="success"){
    const publicUrl=process.env.R2_PUBLIC_URL?.replace(/\/$/,"")||"";
    const resultUrl=publicUrl?`${publicUrl}/influencer/${user.id}/${item.profile_id}/${item.id}/video.mp4`:item.result_url;
    const sourceMetadata = await fetchSourceMetadata(item.source_url);
    const sourceDescription = item.source_description || sourceMetadata.description;
    const sourceTitle = item.title || sourceMetadata.title || (/(?:^|\.)instagram\.com$/i.test(String(new URL(item.source_url||"https://instagram.com").hostname||"")) ? (()=>{try{const u=new URL(item.source_url);const match=u.pathname.match(/^\\/(?:reel|reels|p)\\/([^/?#]+)/i);return match?.[1] ? `Instagram Reel · ${match[1]}` : "Instagram Reel";}catch{return "Instagram Reel";}})() : null);
    const updated={status:"available",progress:100,stage:"ready",r2_key:`influencer/${user.id}/${item.profile_id}/${item.id}/video.mp4`,result_url:resultUrl,title:sourceTitle,source_description:sourceDescription,duration_seconds:item.duration_seconds||null,error_message:null,updated_at:new Date().toISOString()};
    const {data:done}=await admin.from("influencer_content_items").update(updated).eq("id",id).eq("user_id",user.id).select("*").single();
    await admin.from("influencer_content_shares")
      .update({status:"available",error_message:null,updated_at:new Date().toISOString()})
      .eq("item_id",id).eq("user_id",user.id).eq("status","queued");
    return NextResponse.json({item:done||{...item,...updated}},{headers:{"Cache-Control":"no-store"}});
   }
   const updated={status:"failed",progress,stage:"error",error_message:run.conclusion==="cancelled"?"Processamento cancelado.":"O Influencer Manager Worker terminou com erro.",updated_at:new Date().toISOString()};
   const {data:failed}=await admin.from("influencer_content_items").update(updated).eq("id",id).eq("user_id",user.id).select("*").single();
   await admin.from("influencer_content_shares")
     .update({status:"failed",error_message:updated.error_message,updated_at:new Date().toISOString()})
     .eq("item_id",id).eq("user_id",user.id).eq("status","queued");
   return NextResponse.json({item:failed||{...item,...updated}},{headers:{"Cache-Control":"no-store"}});
  }
  if(!item.worker_run_id){await admin.from("influencer_content_items").update({worker_run_id:run.id,progress,stage,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id);}
  else await admin.from("influencer_content_items").update({progress,stage,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id);
  return NextResponse.json({item:{...item,worker_run_id:run.id,progress,stage}},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({item,error:error instanceof Error?error.message:"Erro ao consultar worker."},{headers:{"Cache-Control":"no-store"}});}
}