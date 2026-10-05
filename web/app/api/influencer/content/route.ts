import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 32 * 1024;

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

function instagramFallbackTitle(sourceUrl:string) {
  try {
    const u=new URL(sourceUrl);
    const match=u.pathname.match(/^\/(?:reel|reels|p)\/([^/?#]+)/i);
    return match?.[1] ? `Instagram Reel · ${match[1]}` : "Instagram Reel";
  } catch {
    return "Instagram Reel";
  }
}

function normalizeSourceUrl(value:string) {
  try {
    const u=new URL(value.trim());
    const host=u.hostname.toLowerCase().replace(/^www\./,"");
    if(host==="youtu.be"){
      const id=u.pathname.replace(/^\//,"").split("/")[0];
      return id ? `youtube:${id}` : `url:${u.toString().replace(/#.*$/,"")}`;
    }
    if(host==="youtube.com" || host.endsWith(".youtube.com")){
      const id=u.searchParams.get("v");
      if(id) return `youtube:${id}`;
      const pathMatch=u.pathname.match(/^\/shorts\/([^/?#]+)/i);
      if(pathMatch?.[1]) return `youtube:${pathMatch[1]}`;
    }
    if(host==="instagram.com" || host.endsWith(".instagram.com")){
      return `instagram:${u.pathname.replace(/\/+$/,"").toLowerCase()}`;
    }
    return `url:${u.toString().replace(/#.*$/,"")}`;
  } catch {
    return `url:${value.trim()}`;
  }
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
  const {data:profile}=await admin.from("influencer_profiles")
    .select("id,name,fixed_publish_title,fixed_publish_description")
    .eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});

  const {data:links,error:linksError}=await admin.from("influencer_profile_libraries")
    .select("library_id,priority,enabled")
    .eq("profile_id",profileId).eq("user_id",user.id).eq("enabled",true)
    .order("priority",{ascending:true});
  if(linksError) return NextResponse.json({error:"Não foi possível carregar as bibliotecas do perfil."},{status:500});

  const libraryIds=(links||[]).map((row:any)=>row.library_id).filter(Boolean);
  if(!libraryIds.length) return NextResponse.json({items:[],sharedWith:[],libraries:[]},{headers:{"Cache-Control":"no-store"}});

  const {data:items,error:itemError}=await admin.from("influencer_content_items")
    .select("*").in("library_id",libraryIds).eq("user_id",user.id)
    .order("created_at",{ascending:false});
  if(itemError) return NextResponse.json({error:"Não foi possível carregar a biblioteca."},{status:500});

  const itemIds=(items||[]).map((item:any)=>item.id);
  const {data:states}=itemIds.length
    ? await admin.from("influencer_profile_content")
      .select("item_id,status,scheduled_at,published_at,error_message,retry_count")
      .eq("profile_id",profileId).eq("user_id",user.id).in("item_id",itemIds)
    : {data:[]};
  const stateByItem=new Map((states||[]).map((row:any)=>[row.item_id,row]));

  const sourceProfileIds=Array.from(new Set((items||[]).map((item:any)=>item.profile_id).filter(Boolean)));
  const {data:sourceProfiles}=sourceProfileIds.length
    ? await admin.from("influencer_profiles").select("id,name").in("id",sourceProfileIds).eq("user_id",user.id)
    : {data:[]};
  const sourceNames=new Map((sourceProfiles||[]).map((p:any)=>[p.id,p.name]));

  const normalized=(items||[]).map((item:any)=>{
    const state=stateByItem.get(item.id);
    const shared=item.profile_id!==profileId;
    return {
      ...item,
      profile_id:profileId,
      source_profile_id:item.profile_id,
      source_profile_name:shared ? (sourceNames.get(item.profile_id)||"Outro perfil") : undefined,
      shared,
      status:(item.status==="available" && ["processing","queued","scheduled"].includes(state?.status||"")) ? "available" : (state?.status || (item.status==="processing" ? "processing" : item.status)),
      scheduled_at:state?.scheduled_at ?? item.scheduled_at,
      published_at:state?.published_at ?? (shared ? null : item.published_at),
      error_message:state?.error_message ?? item.error_message,
      retry_count:state?.retry_count ?? item.retry_count,
      publish_title:profile.fixed_publish_title?.trim() || item.publish_title,
      publish_description:profile.fixed_publish_description?.trim() || item.publish_description
    };
  });
  return NextResponse.json({
    items:normalized,
    sharedWith:[],
    libraries:libraryIds.map((id:string)=>({id,priority:(links||[]).find((row:any)=>row.library_id===id)?.priority||0}))
  },{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request) {
  const contentLength=Number(request.headers.get("content-length")||0);
  if(contentLength>MAX_BODY_BYTES)return NextResponse.json({error:"Requisição muito grande."},{status:413});
  const user=await auth();
  if(!user) return NextResponse.json({error:"Entre no Clip Factory."},{status:401});
  const mutationRate=rateLimit(getClientKey(request,user.id),30,60*60*1000);
  if(!mutationRate.allowed)return NextResponse.json({error:"Limite de alterações do Influencer Manager atingido. Aguarde antes de tentar novamente."},{status:429,headers:{"Retry-After":String(mutationRate.retryAfterSeconds)}});
  const body=await request.json().catch(()=>null);
  const profileId=typeof body?.profileId==="string"?body.profileId:"";

  if(body?.action==="unshare-library"){
    const targetProfileId=typeof body?.targetProfileId==="string"?body.targetProfileId:"";
    if(!profileId||!targetProfileId||profileId===targetProfileId) return NextResponse.json({error:"Perfis de compartilhamento inválidos."},{status:400});
    const admin=createAdminClient();
    const {data:sourceProfile}=await admin.from("influencer_profiles").select("id").eq("id",profileId).eq("user_id",user.id).maybeSingle();
    if(!sourceProfile) return NextResponse.json({error:"Perfil de origem não encontrado."},{status:404});
    const {data:targetProfile}=await admin.from("influencer_profiles").select("id").eq("id",targetProfileId).eq("user_id",user.id).maybeSingle();
    if(!targetProfile) return NextResponse.json({error:"Perfil de destino não encontrado."},{status:404});
    // A biblioteca pode estar vinculada ao destino independentemente de qualquer compartilhamento.
    // Como o vínculo não registra sua origem, removê-lo aqui poderia retirar acesso legítimo.
    // A remoção explícita deve ser feita em Gerenciar bibliotecas no perfil de destino.
    return NextResponse.json({
      error:"Para não remover um vínculo independente, desvincule a biblioteca em Gerenciar bibliotecas no perfil de destino."
    },{status:409});
  }
  if(body?.action==="share-library"){
    const targetProfileIds=Array.isArray(body?.targetProfileIds)?body.targetProfileIds.filter((v:unknown)=>typeof v==="string"): [];
    if(!profileId||!targetProfileIds.length) return NextResponse.json({error:"Selecione pelo menos um perfil de destino."},{status:400});
    const admin=createAdminClient();
    const {data:sourceProfile}=await admin.from("influencer_profiles").select("id").eq("id",profileId).eq("user_id",user.id).maybeSingle();
    if(!sourceProfile) return NextResponse.json({error:"Perfil de origem não encontrado."},{status:404});
    const uniqueTargets=Array.from(new Set<string>(targetProfileIds)).filter(id=>id!==profileId);
    const {data:profiles}=await admin.from("influencer_profiles").select("id").in("id",uniqueTargets).eq("user_id",user.id);
    if((profiles||[]).length!==uniqueTargets.length) return NextResponse.json({error:"Um ou mais perfis de destino não pertencem à sua conta."},{status:403});
    const {data:sourceLinks,error:sourceLinksError}=await admin.from("influencer_profile_libraries").select("library_id,priority")
      .eq("profile_id",profileId).eq("user_id",user.id).eq("enabled",true);
    if(sourceLinksError) return NextResponse.json({error:"Não foi possível localizar as bibliotecas do perfil."},{status:500});
    if(!sourceLinks?.length) return NextResponse.json({error:"O perfil não possui bibliotecas vinculadas."},{status:400});
    const sourceLibraryIds=sourceLinks.map((link:any)=>link.library_id).filter(Boolean);
    const {data:existingTargetLinks,error:existingTargetLinksError}=await admin.from("influencer_profile_libraries")
      .select("profile_id,library_id").in("profile_id",uniqueTargets).in("library_id",sourceLibraryIds).eq("user_id",user.id);
    if(existingTargetLinksError) return NextResponse.json({error:"Não foi possível verificar os vínculos existentes dos perfis de destino."},{status:500});
    const existingLinkKeys=new Set((existingTargetLinks||[]).map((row:any)=>row.profile_id+"::"+row.library_id));
    // Insert only missing links. Do not overwrite a target profile's independent priority/enabled settings.
    const rows=uniqueTargets.flatMap((targetId:string)=>sourceLinks.filter((link:any)=>!existingLinkKeys.has(targetId+"::"+link.library_id)).map((link:any)=>({
      profile_id:targetId,library_id:link.library_id,user_id:user.id,priority:Number(link.priority)||0,enabled:true
    })));
    if(rows.length){
      const {error:linkError}=await admin.from("influencer_profile_libraries").insert(rows);
      if(linkError){
        console.error("Influencer library share failed:",{code:linkError.code,message:linkError.message,details:linkError.details,hint:linkError.hint});
        return NextResponse.json({error:"Não foi possível compartilhar as bibliotecas. Código do banco: "+(linkError.code||"desconhecido")},{status:500});
      }
    }
    const libraryIds=sourceLinks.map((link:any)=>link.library_id).filter(Boolean);
    const {data:items}=await admin.from("influencer_content_items").select("id,status").in("library_id",libraryIds).eq("user_id",user.id);
    const itemIds=(items||[]).map((item:any)=>item.id);
    if(itemIds.length){
      const {data:existingStates,error:stateLookupError}=await admin.from("influencer_profile_content")
        .select("item_id,profile_id").in("item_id",itemIds).in("profile_id",uniqueTargets).eq("user_id",user.id);
      if(stateLookupError) return NextResponse.json({error:"As bibliotecas foram vinculadas, mas não foi possível preparar o conteúdo para os perfis."},{status:500});
      const existingKeys=new Set((existingStates||[]).map((row:any)=>row.item_id+"::"+row.profile_id));
      const stateRows=uniqueTargets.flatMap((targetId:string)=>(items||[]).filter((item:any)=>!existingKeys.has(item.id+"::"+targetId)).map((item:any)=>({
        profile_id:targetId,item_id:item.id,user_id:user.id,
        status:item.status==="processing"||item.status==="queued"?"queued":item.status==="failed"?"failed":"available",retry_count:0
      })));
      if(stateRows.length){
        const {error:stateInsertError}=await admin.from("influencer_profile_content").insert(stateRows);
        if(stateInsertError) return NextResponse.json({error:"As bibliotecas foram vinculadas, mas não foi possível preparar todo o conteúdo para os perfis."},{status:500});
      }
    }
    return NextResponse.json({ok:true,sharedItems:items?.length||0,sharedProfiles:uniqueTargets.length,sharedLibraries:sourceLinks.length},{status:201});
  }
  const sourceUrl=typeof body?.sourceUrl==="string"?body.sourceUrl.trim():"";
  let title=typeof body?.title==="string"?body.title.trim().slice(0,500):"";
  if(!profileId||!sourceUrl||sourceUrl.length>2048) return NextResponse.json({error:"Informe o perfil e a URL do vídeo."},{status:400});
  let parsed:URL;
  try{parsed=new URL(sourceUrl);}catch{return NextResponse.json({error:"URL inválida."},{status:400});}
  const host=parsed.hostname.toLowerCase();
  const isYoutube=host==="youtube.com"||host.endsWith(".youtube.com")||host==="youtu.be";
  const isInstagram=host==="instagram.com"||host.endsWith(".instagram.com");
  const isInstagramReel=/^\/((reel|reels|p))\//i.test(parsed.pathname);
  if(parsed.protocol!=="https:"||!isYoutube&&!isInstagram) return NextResponse.json({error:"Informe uma URL válida do YouTube ou de um Reel do Instagram."},{status:400});
  if(isInstagram&&!isInstagramReel) return NextResponse.json({error:"Para Instagram, cole a URL de um Reel público."},{status:400});
  const admin=createAdminClient();
  const {data:profile}=await admin.from("influencer_profiles").select("id,fixed_publish_title,fixed_publish_description,caption_mode").eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});
  const requestedLibraryId=typeof body?.libraryId==="string"?body.libraryId:"";
  const {data:libraryLinks,error:libraryLinksError}=await admin.from("influencer_profile_libraries")
    .select("library_id,priority").eq("profile_id",profileId).eq("user_id",user.id).eq("enabled",true)
    .order("priority",{ascending:true});
  if(libraryLinksError) return NextResponse.json({error:"Não foi possível localizar as bibliotecas deste perfil."},{status:500});
  const libraryId=requestedLibraryId || libraryLinks?.[0]?.library_id;
  if(!libraryId) return NextResponse.json({error:"Este perfil ainda não possui uma biblioteca vinculada."},{status:409});
  if(requestedLibraryId && !(libraryLinks||[]).some((row:any)=>row.library_id===requestedLibraryId)){
    return NextResponse.json({error:"A biblioteca selecionada não está vinculada a este perfil."},{status:403});
  }
  const {data:existingItems,error:existingItemsError}=await admin
    .from("influencer_content_items")
    .select("id,source_url,title,status")
    .eq("library_id",libraryId)
    .eq("user_id",user.id);
  if(existingItemsError){
    console.error("Influencer duplicate check failed:",existingItemsError);
    return NextResponse.json({error:"Não foi possível verificar se este vídeo já está na biblioteca."},{status:500});
  }
  const normalizedSource=normalizeSourceUrl(sourceUrl);
  const duplicate=(existingItems||[]).find((item:any)=>normalizeSourceUrl(String(item.source_url||""))===normalizedSource);
  if(duplicate){
    return NextResponse.json({
      error:"Este vídeo já está na biblioteca deste perfil.",
      duplicate:true,
      item:{id:duplicate.id,title:duplicate.title,status:duplicate.status}
    },{status:409});
  }

  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});
  if(!title){try{const o=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`,{cache:"no-store"});if(o.ok){const m=await o.json().catch(()=>({}));if(typeof m?.title==="string")title=m.title.trim().slice(0,500);}}catch{}}
  const {data:captionRows}=await admin.from("influencer_captions").select("id,language,caption").eq("profile_id",profileId).eq("active",true);
  const captions=captionRows||[];
  const caption= captions.length ? captions[Math.floor(Math.random()*captions.length)] : null;

  const language = caption?.language === "ja" ? "ja" : profile.caption_mode === "ja_random" ? "ja" : profile.caption_mode === "zh_random" ? "zh" : Math.random() < 0.5 ? "ja" : "zh";
  const generated = randomCopy(language);
  const copy = {
    title: profile.fixed_publish_title?.trim() || generated.title,
    description: profile.fixed_publish_description?.trim() || generated.description,
  };

  const itemId=crypto.randomUUID();
  const {data:item,error}=await admin.from("influencer_content_items").insert({
    id:itemId,profile_id:profileId,library_id:libraryId,user_id:user.id,source_url:sourceUrl,title:title||null,source_type:"url",status:"processing",progress:5,stage:"queued",worker_job_id:itemId,publish_title:copy.title,publish_description:copy.description,source_description:null
  }).select("*").single();
  if(error){console.error("Influencer item creation failed:",error);return NextResponse.json({error:"Não foi possível adicionar o vídeo à biblioteca."},{status:500});}

  const {error:stateError}=await admin.from("influencer_profile_content").insert({
    profile_id:profileId,item_id:itemId,user_id:user.id,status:"processing",retry_count:0
  });
  if(stateError){
    console.error("Influencer profile content state creation failed:",stateError);
    await admin.from("influencer_content_items").delete().eq("id",itemId).eq("user_id",user.id);
    return NextResponse.json({error:"Não foi possível preparar o vídeo para publicação."},{status:500});
  }

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
  const mutationRate=rateLimit(getClientKey(request,user.id),60,60*60*1000);
  if(!mutationRate.allowed)return NextResponse.json({error:"Limite de alterações do conteúdo atingido. Aguarde antes de tentar novamente."},{status:429,headers:{"Retry-After":String(mutationRate.retryAfterSeconds)}});
  const body=await request.json().catch(()=>null);
  const id=typeof body?.id==="string"?body.id:"";
  if(!id) return NextResponse.json({error:"Conteúdo inválido."},{status:400});
  const admin=createAdminClient();
  const requestedProfileId=typeof body?.profileId==="string"?body.profileId:"";
  const {data:item,error:itemError}=await admin.from("influencer_content_items").select("id,profile_id,title,publish_title,publish_description").eq("id",id).eq("user_id",user.id).maybeSingle();
  if(itemError||!item) return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});
  if(body?.randomize===true){
    const effectiveProfileId=requestedProfileId||item.profile_id;
    const {data:profile}=await admin.from("influencer_profiles").select("caption_mode").eq("id",effectiveProfileId).eq("user_id",user.id).maybeSingle();
    const mode=profile?.caption_mode||"zh_ja_random";
    const language=mode==="ja_random"?"ja":mode==="zh_random"?"zh":Math.random()<0.5?"ja":"zh";
    const copy=randomCopy(language,item.publish_title,item.publish_description);
    const {data:updated,error}=await admin.from("influencer_content_items").update({publish_title:copy.title,publish_description:copy.description,updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id).select("*").single();
    if(error)return NextResponse.json({error:"Não foi possível gerar um novo nome e descrição."},{status:500});
    return NextResponse.json({item:updated});
  }
  const allowed:Record<string,unknown>={};
  if(typeof body?.title==="string") allowed.title=body.title.trim().slice(0,500)||null;
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
  const mutationRate=rateLimit(getClientKey(request,user.id),30,60*60*1000);
  if(!mutationRate.allowed)return NextResponse.json({error:"Limite de exclusões do conteúdo atingido. Aguarde antes de tentar novamente."},{status:429,headers:{"Retry-After":String(mutationRate.retryAfterSeconds)}});

  const requestUrl=new URL(request.url);
  const id=requestUrl.searchParams.get("id")||"";
  const profileId=requestUrl.searchParams.get("profileId")||"";
  if(!id||!profileId) return NextResponse.json({error:"Conteúdo ou perfil inválido."},{status:400});

  const admin=createAdminClient();
  const {data:profile}=await admin.from("influencer_profiles").select("id").eq("id",profileId).eq("user_id",user.id).maybeSingle();
  if(!profile) return NextResponse.json({error:"Perfil não encontrado."},{status:404});

  const {data:item}=await admin.from("influencer_content_items")
    .select("id,profile_id,status,worker_run_id,r2_key")
    .eq("id",id).eq("user_id",user.id).maybeSingle();
  if(!item) return NextResponse.json({error:"Conteúdo não encontrado."},{status:404});

  // A library item may be visible to multiple profiles. Removing it from a
  // destination profile must only remove that profile's publication state.
  if(item.profile_id!==profileId){
    const {error}=await admin.from("influencer_profile_content")
      .delete().eq("profile_id",profileId).eq("item_id",id).eq("user_id",user.id);
    if(error) return NextResponse.json({error:"Não foi possível remover o vídeo deste perfil."},{status:500});
    return NextResponse.json({ok:true,removedFromProfile:true});
  }

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
