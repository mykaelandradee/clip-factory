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

const REEL_TITLES = {
  zh: ["你可能不知道的一个瞬间","这个细节真的很有意思","一个值得注意的小事实","原来还有这样的事情","很多人都忽略了这一点","这个瞬间背后有个细节","一个意外又有趣的发现","生活中容易错过的小知识"],
  ja: ["意外と知らない瞬間","この細かい部分が面白い","知っておきたい小さな事実","実はこんなことがあります","多くの人が見落とすポイント","この瞬間には秘密があります","意外で面白い小さな発見","日常で見逃しやすい豆知識"],
} as const;
const REEL_DESCRIPTIONS = {
  zh: ["你知道吗？很多看似普通的瞬间，其实都藏着一些有趣的细节。这个画面之所以特别，是因为我们平时很少注意到这些小变化。","有趣的是，人们往往只关注结果，却很少观察过程中的细节。类似的情况在日常生活中非常常见，也因此更容易让人产生共鸣。","这个瞬间看起来很简单，但背后其实有一个值得注意的小事实。很多人第一次看到时都会忽略这一点，直到再次观看才发现细节。","生活里有很多意想不到的瞬间，它们不一定复杂，却总能让人停下来多看几秒。这个画面就是一个很好的例子。","一个有意思的冷知识是，我们的大脑会自动忽略大量重复的信息，所以一些特别的小细节反而更容易被错过。这也是这个瞬间有趣的地方。","有时候最有趣的内容并不是发生了什么，而是事情发生的方式。仔细观察这个画面，会发现一个很容易被忽略的小细节。"],
  ja: ["知っていますか？一見すると普通の瞬間でも、よく見ると意外と面白い細かな部分が隠れています。普段は気づかない変化ほど印象に残ります。","面白いのは、人は結果ばかりに注目して途中の細かな動きを見落としやすいことです。日常でも同じようなことが意外とたくさんあります。","この瞬間はシンプルに見えますが、実はちょっとした豆知識につながるポイントがあります。最初は気づかなくても、もう一度見ると発見できます。","日常には予想していなかった瞬間がたくさんあります。特別に複雑ではなくても、少し視点を変えるだけで面白く見えることがあります。","人間の脳は繰り返される情報を自然に省略するため、小さな変化ほど見逃しやすいと言われています。だからこそ、この場面の細部が面白く感じられます。","面白いのは何が起きたかだけではなく、どのように起きたかという部分です。この動画を少し注意して見ると、見逃しやすい細かなポイントに気づけます。"],
} as const;
function randomCopy(language:"zh"|"ja", currentTitle?:string|null, currentDescription?:string|null) {
  const titles=REEL_TITLES[language].filter(v=>v!==currentTitle);
  const descriptions=REEL_DESCRIPTIONS[language].filter(v=>v!==currentDescription);
  const tp=titles.length?titles:REEL_TITLES[language], dp=descriptions.length?descriptions:REEL_DESCRIPTIONS[language];
  return {title:tp[Math.floor(Math.random()*tp.length)],description:dp[Math.floor(Math.random()*dp.length)]};
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
  const {data:shares}=await admin.from("influencer_content_shares").select("id,item_id,profile_id,status,scheduled_at,published_at,error_message,created_at").eq("profile_id",profileId).eq("user_id",user.id).order("created_at",{ascending:false});
  let sharedItems:any[]=[];
  if(shares?.length){
    const ids=shares.map((share:any)=>share.item_id);
    const {data:sourceItems}=await admin.from("influencer_content_items").select("*").in("id",ids).eq("user_id",user.id);
    const byId=new Map((sourceItems||[]).map((item:any)=>[item.id,item]));
    sharedItems=shares.map((share:any)=>{const item=byId.get(share.item_id);return item?{...item,id:item.id,profile_id:profileId,share_id:share.id,shared:true,status:share.status,scheduled_at:share.scheduled_at,published_at:share.published_at,error_message:share.error_message}:null}).filter(Boolean);
  }
  const ownIds=new Set((data||[]).map((item:any)=>item.id));
  return NextResponse.json({items:[...(data||[]),...sharedItems.filter((item:any)=>!ownIds.has(item.id))].sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at)))},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request) {
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
  const body=await request.json().catch(()=>null);
  const profileId=typeof body?.profileId==="string"?body.profileId:"";

  if(body?.action==="share"){
    const itemId=typeof body?.itemId==="string"?body.itemId:"";
    const targetProfileIds=Array.isArray(body?.targetProfileIds)?body.targetProfileIds.filter((v:unknown)=>typeof v==="string"): [];
    if(!itemId||!targetProfileIds.length) return NextResponse.json({error:"Informe o conteúdo e pelo menos um perfil de destino."},{status:400});
    const admin=createAdminClient();
    const {data:item}=await admin.from("influencer_content_items").select("id,profile_id,user_id,status").eq("id",itemId).eq("user_id",user.id).maybeSingle();
    if(!item) return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});
    const uniqueTargets=[...new Set(targetProfileIds)].filter((id:string)=>id!==item.profile_id);
    if(!uniqueTargets.length) return NextResponse.json({error:"Escolha um perfil diferente do perfil atual."},{status:400});
    const {data:profiles}=await admin.from("influencer_profiles").select("id").in("id",uniqueTargets).eq("user_id",user.id);
    if((profiles||[]).length!==uniqueTargets.length) return NextResponse.json({error:"Um ou mais perfis de destino não pertencem à sua conta."},{status:403});
    const rows=uniqueTargets.map((targetId:string)=>({item_id:item.id,profile_id:targetId,user_id:user.id,status:item.status==="available"?"available":"queued"}));
    const {data:shares,error}=await admin.from("influencer_content_shares").upsert(rows,{onConflict:"item_id,profile_id"}).select("*");
    if(error){console.error("Influencer library share failed:",error);return NextResponse.json({error:"Não foi possível compartilhar a biblioteca."},{status:500});}
    return NextResponse.json({ok:true,shares:shares||[]},{status:201});
  }
  const sourceUrl=typeof body?.sourceUrl==="string"?body.sourceUrl.trim():"";
  let title=typeof body?.title==="string"?body.title.trim().slice(0,500):"";
  if(!profileId||!sourceUrl||sourceUrl.length>2048) return NextResponse.json({error:"Informe o perfil e a URL do vídeo."},{status:400});
  let parsed:URL;
  try{parsed=new URL(sourceUrl);}catch{return NextResponse.json({error:"URL inválida."},{status:400});}
  if(parsed.protocol!=="https:"||(parsed.hostname!=="youtube.com"&&!parsed.hostname.endsWith(".youtube.com")&&parsed.hostname!=="youtu.be")) return NextResponse.json({error:"Informe uma URL válida do YouTube."},{status:400});
  const admin=createAdminClient();
  const {data:profile}=await admin.from("influencer_profiles").select("id").eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});
  if(!title){try{const o=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`,{cache:"no-store"});if(o.ok){const m=await o.json().catch(()=>({}));if(typeof m?.title==="string")title=m.title.trim().slice(0,500);}}catch{}}
  const {data:captionRows}=await admin.from("influencer_captions").select("id,language,caption").eq("profile_id",profileId).eq("active",true);
  const captions=captionRows||[];
  const caption= captions.length ? captions[Math.floor(Math.random()*captions.length)] : null;

  const language = caption?.language === "ja" ? "ja" : "zh";
  const copy = randomCopy(language);

  const itemId=crypto.randomUUID();
  const {data:item,error}=await admin.from("influencer_content_items").insert({
    id:itemId,profile_id:profileId,user_id:user.id,source_url:sourceUrl,title:title||null,source_type:"url",status:"processing",progress:5,stage:"queued",worker_job_id:itemId,publish_title:copy.title,publish_description:copy.description,source_description:null
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

export async function PATCH(request:Request) {
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
  const body=await request.json().catch(()=>null);
  const id=typeof body?.id==="string"?body.id:"";
  if(!id) return NextResponse.json({error:"Conteúdo inválido."},{status:400});
  const admin=createAdminClient();
  const {data:item,error:itemError}=await admin.from("influencer_content_items").select("id,profile_id,publish_title,publish_description").eq("id",id).eq("user_id",user.id).maybeSingle();
  if(itemError||!item) return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});
  if(body?.randomize===true){
    const {data:profile}=await admin.from("influencer_profiles").select("caption_mode").eq("id",item.profile_id).eq("user_id",user.id).maybeSingle();
    const mode=profile?.caption_mode||"zh_ja_random";
    const language=mode==="ja_random"?"ja":mode==="zh_random"?"zh":Math.random()<0.5?"ja":"zh";
    const copy=randomCopy(language,item.publish_title,item.publish_description);
    const {data:updated,error}=await admin.from("influencer_content_items").update({publish_title:copy.title,publish_description:copy.description,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id).select("*").single();
    if(error)return NextResponse.json({error:"Não foi possível gerar um novo nome e descrição."},{status:500});
    return NextResponse.json({item:updated});
  }
  const allowed:Record<string,unknown>={};
  if(typeof body?.publishTitle==="string") allowed.publish_title=body.publishTitle.trim().slice(0,500)||null;
  if(typeof body?.publishDescription==="string") allowed.publish_description=body.publishDescription.trim().slice(0,5000)||null;
  if(!Object.keys(allowed).length)return NextResponse.json({error:"Nenhuma alteração informada."},{status:400});
  const {data,error}=await admin.from("influencer_content_items").update({...allowed,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id).select("*").single();
  if(error)return NextResponse.json({error:"Não foi possível salvar os dados do Reel."},{status:500});
  return NextResponse.json({item:data});
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