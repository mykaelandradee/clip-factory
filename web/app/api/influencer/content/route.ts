import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

const GITHUB_API = "https://api.github.com";
const OWNER = "mykaelandradee";
const REPO = "clip-factory";

async function auth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function githubHeaders() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) throw new Error("CLIP_FACTORY_GITHUB_TOKEN não configurado.");
  return { Accept:"application/vnd.github+json", Authorization:`Bearer ${token}`, "X-GitHub-Api-Version":"2022-11-28" };
}

async function githubFetch(path:string, init:RequestInit={}) {
  return fetch(`${GITHUB_API}${path}`, { ...init, headers:{...githubHeaders(),...(init.headers||{})}, cache:"no-store" });
}

export async function GET(request:Request) {
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
  const profileId=new URL(request.url).searchParams.get("profileId")||"";
  if(!profileId) return NextResponse.json({error:"Perfil inválido."},{status:400});
  const admin=createAdminClient();
  const {data,error}=await admin.from("influencer_content_items").select("*").eq("profile_id",profileId).eq("user_id",user.id).order("created_at",{ascending:false});
  if(error) return NextResponse.json({error:"Não foi possível carregar a biblioteca."},{status:500});
  return NextResponse.json({items:data||[]},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request) {
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
  const body=await request.json().catch(()=>null);
  const profileId=typeof body?.profileId==="string"?body.profileId:"";
  const sourceUrl=typeof body?.sourceUrl==="string"?body.sourceUrl.trim():"";
  let title=typeof body?.title==="string"?body.title.trim().slice(0,500):"";
  const publishTitle=typeof body?.publishTitle==="string"?body.publishTitle.trim().slice(0,500):"";
  const publishDescription=typeof body?.publishDescription==="string"?body.publishDescription.trim().slice(0,5000):"";
  if(!profileId||!sourceUrl||sourceUrl.length>2048) return NextResponse.json({error:"Informe o perfil e a URL do vídeo."},{status:400});
  let parsed:URL;
  try{parsed=new URL(sourceUrl);}catch{return NextResponse.json({error:"URL inválida."},{status:400});}
  if(parsed.protocol!=="https:"||(parsed.hostname!=="youtube.com"&&!parsed.hostname.endsWith(".youtube.com")&&parsed.hostname!=="youtu.be")) return NextResponse.json({error:"Informe uma URL válida do YouTube."},{status:400});
  const admin=createAdminClient();
  const {data:profile}=await admin.from("influencer_profiles").select("id").eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});
  if(!title){try{const o=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`,{cache:"no-store"});if(o.ok){const m=await o.json().catch(()=>({}));if(typeof m?.title==="string")title=m.title.trim().slice(0,500);}}catch{}}
  const itemId=crypto.randomUUID();
  const {data:item,error}=await admin.from("influencer_content_items").insert({
    id:itemId,profile_id:profileId,user_id:user.id,source_url:sourceUrl,title:title||null,source_type:"url",status:"processing",progress:5,stage:"queued",worker_job_id:itemId,publish_title:publishTitle||title||null,publish_description:publishDescription||null
  }).select("*").single();
  if(error){console.error("Influencer item creation failed:",error);return NextResponse.json({error:"Não foi possível adicionar o vídeo à biblioteca."},{status:500});}
  try{
    const response=await githubFetch(`/repos/${OWNER}/${REPO}/dispatches`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({event_type:"influencer-manager-job",client_payload:{item_id:itemId,profile_id:profileId,user_id:user.id,url:sourceUrl}})
    });
    if(!response.ok){
      const details=await response.text();
      console.error("Influencer worker dispatch failed:",response.status,details);
      await admin.from("influencer_content_items").update({status:"failed",progress:0,stage:"error",error_message:"Não foi possível iniciar o Influencer Manager Worker.",updated_at:new Date().toISOString()}).eq("id",itemId).eq("user_id",user.id);
      return NextResponse.json({error:"Não foi possível iniciar o Influencer Manager Worker."},{status:502});
    }
    return NextResponse.json({item},{status:202});
  }catch(error){
    await admin.from("influencer_content_items").update({status:"failed",progress:0,stage:"error",error_message:error instanceof Error?error.message:"Erro ao iniciar o worker.",updated_at:new Date().toISOString()}).eq("id",itemId).eq("user_id",user.id);
    return NextResponse.json({error:"Não foi possível iniciar o Influencer Manager Worker."},{status:502});
  }
}

export async function DELETE(request:Request) {
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
  const id=new URL(request.url).searchParams.get("id")||"";
  if(!id) return NextResponse.json({error:"Conteúdo inválido."},{status:400});
  const admin=createAdminClient();
  const {data:item}=await admin.from("influencer_content_items").select("id,status,worker_run_id,r2_key").eq("id",id).eq("user_id",user.id).maybeSingle();
  if(!item) return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});
  if(item.status==="processing"&&item.worker_run_id){
    try{await githubFetch(`/repos/${OWNER}/${REPO}/actions/runs/${item.worker_run_id}/cancel`,{method:"POST"});}catch(error){console.warn("Influencer worker cancel failed:",error);}
  }
  if(item.r2_key){
    try{
      const {S3Client,DeleteObjectCommand}=await import("@aws-sdk/client-s3");
      const accountId=process.env.R2_ACCOUNT_ID, bucket=process.env.R2_BUCKET_NAME, accessKeyId=process.env.R2_ACCESS_KEY_ID, secretAccessKey=process.env.R2_SECRET_ACCESS_KEY;
      if(accountId&&bucket&&accessKeyId&&secretAccessKey){
        const client=new S3Client({region:"auto",endpoint:`https://${accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey}});
        await client.send(new DeleteObjectCommand({Bucket:bucket,Key:item.r2_key}));
      }
    }catch(error){console.warn("Influencer R2 cleanup failed:",error);}
  }
  const {error}=await admin.from("influencer_content_items").delete().eq("id",id).eq("user_id",user.id);
  if(error)return NextResponse.json({error:"Não foi possível excluir o conteúdo."},{status:500});
  return NextResponse.json({ok:true});
}