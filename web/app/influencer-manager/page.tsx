"use client";

// Keep title editing available for every own library item, including untitled Instagram sources.

import { FormEvent, useEffect, useMemo, useState } from "react";

type Profile={
  id:string; name:string; description?:string|null; instagram_username:string|null; posts_per_day:number;
  posting_times:string[]; caption_mode:string; auto_publish:boolean;
  repeat_when_exhausted:boolean; cover_r2_key?:string|null; fixed_publish_title?:string|null; fixed_publish_description?:string|null; share_to_feed?:boolean; publishing_enabled?:boolean; next_publish_at?:string|null; publish_retry_count?:number;
};
type Item={
  id:string; source_url:string; title:string|null; status:string; created_at:string; published_at?:string|null; share_id?:string|null; shared?:boolean;
  r2_key?:string|null; result_url?:string|null; publish_title?:string|null;
  publish_description?:string|null; source_description?:string|null;
  error_message?:string|null; progress?:number; stage?:string|null; source_profile_id?:string|null; source_profile_name?:string|null;
};
const STATUS:Record<string,string>={queued:"Na fila",processing:"Processando",available:"Disponível",scheduled:"Publicando",published:"Publicado",failed:"Erro",archived:"Arquivado"};

export default function InfluencerManagerPage(){
 const [profiles,setProfiles]=useState<Profile[]>([]),[selected,setSelected]=useState<Profile|null>(null),[items,setItems]=useState<Item[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const [showNew,setShowNew]=useState(false),[showProfiles,setShowProfiles]=useState(false),[name,setName]=useState(""),[posts,setPosts]=useState("3");
 const [url,setUrl]=useState(""),[videoTitle,setVideoTitle]=useState(""),[adding,setAdding]=useState(false),[publishing,setPublishing]=useState(false),[publishingItem,setPublishingItem]=useState<string|null>(null),[randomizingItem,setRandomizingItem]=useState<string|null>(null),[coverFile,setCoverFile]=useState<File|null>(null),[uploadingCover,setUploadingCover]=useState(false);
 const [coverPreviewKey,setCoverPreviewKey]=useState("");
 const [localCoverPreview,setLocalCoverPreview]=useState("");
 const [instagramConnected,setInstagramConnected]=useState(false),[instagramAccount,setInstagramAccount]=useState("");
 const [instagramReconnect,setInstagramReconnect]=useState(false),[instagramExpiresAt,setInstagramExpiresAt]=useState<string|null>(null);
 const [renamingItem,setRenamingItem]=useState<string|null>(null),[titleDraft,setTitleDraft]=useState("");
 const [shareTargets,setShareTargets]=useState<string[]>([]);
 const [sharedWith,setSharedWith]=useState<string[]>([]);
 const [sharing,setSharing]=useState(false);
 const [profileDraft,setProfileDraft]=useState<{posts_per_day:number;caption_mode:string;repeat_when_exhausted:boolean;posting_times:string[];fixed_publish_title:string;fixed_publish_description:string;share_to_feed:boolean}>({posts_per_day:3,caption_mode:"zh_ja_random",repeat_when_exhausted:false,posting_times:["09:00","11:30","14:00"],fixed_publish_title:"",fixed_publish_description:"",share_to_feed:true});
 const [profileSaving,setProfileSaving]=useState(false);
 const [inlineError,setInlineError]=useState<{section:string;message:string}|null>(null);
 const showSectionError=(section:string,message:string)=>setInlineError({section,message});
 const clearSectionError=(section:string)=>setInlineError(v=>v?.section===section?null:v);
 const feedbackMessage=error||inlineError?.message||"";
 const [shareOpen,setShareOpen]=useState(false);
 const coverPreviewUrl=selected?.cover_r2_key ? `/api/influencer/cover?profileId=${encodeURIComponent(selected.id)}&v=${encodeURIComponent(selected.cover_r2_key)}` : "";

 async function loadProfiles(){
  setLoading(true);setError("");
  try{const r=await fetch("/api/influencer/profiles",{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível carregar os perfis.");
   const nextProfiles=d.profiles||[];
   const requestedId=new URLSearchParams(window.location.search).get("profileId");
   setProfiles(nextProfiles);
   setSelected(current=>{
    const requested=requestedId ? nextProfiles.find((p:Profile)=>p.id===requestedId) : null;
    return requested || (current ? nextProfiles.find((p:Profile)=>p.id===current.id)||null : null) || nextProfiles[0] || null;
   });
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar.");}finally{setLoading(false);}
 }
 async function loadItems(id:string){
  try{const r=await fetch("/api/influencer/content?profileId="+encodeURIComponent(id),{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível carregar a biblioteca.");setItems(d.items||[]);setSharedWith(Array.isArray(d.sharedWith)?d.sharedWith:[]);setShareTargets([]);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar a biblioteca.");}
 }
 useEffect(()=>{void loadProfiles();},[]);
 async function disconnectInstagram(){
  if(!selected)return;
  if(!window.confirm(`Desvincular o Instagram ${instagramAccount||"deste perfil"}? A publicação automática deste perfil será interrompida.`))return;
  setSaving(true);setError("");
  try{
   const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(selected.id),{method:"DELETE"});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível desvincular o Instagram.");
   setInstagramConnected(false);setInstagramReconnect(false);setInstagramExpiresAt(null);setInstagramAccount("");
   if(d.profile){
    setSelected(d.profile);
    setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));
   }
  }catch(e){setError(e instanceof Error?e.message:"Erro ao desvincular o Instagram.");}
  finally{setSaving(false);}
 }
 async function loadInstagramConnection(profileId:string){
  try{const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(profileId),{cache:"no-store"}),d=await r.json().catch(()=>({}));
   setInstagramConnected(Boolean(r.ok&&d.connected));
   setInstagramReconnect(Boolean(d.requiresReconnect));
   setInstagramExpiresAt(typeof d.expiresAt==="string"?d.expiresAt:null);
   setInstagramAccount(typeof d.username==="string"&&d.username?`@${d.username.replace(/^@/,"")}`:"");
  }catch{setInstagramConnected(false);setInstagramReconnect(false);setInstagramExpiresAt(null);setInstagramAccount("");}
 }
 useEffect(()=>{
  if(selected){
   setProfileDraft({
    posts_per_day:selected.posts_per_day||3,
    caption_mode:selected.caption_mode||"zh_ja_random",
    repeat_when_exhausted:Boolean(selected.repeat_when_exhausted),
    posting_times:[...(selected.posting_times||[])],
    fixed_publish_title:selected.fixed_publish_title||"",
    fixed_publish_description:selected.fixed_publish_description||"",
    share_to_feed:selected.share_to_feed!==false
   });
  }
  setCoverFile(null);
  setCoverPreviewKey(selected?.cover_r2_key||"");
  if(selected){void loadItems(selected.id);void loadInstagramConnection(selected.id);}else{setItems([]);setInstagramConnected(false);setInstagramAccount("");}
 },[selected?.id,selected?.cover_r2_key]);
 useEffect(()=>{if(!selected||!items.some(i=>i.status==="processing"))return;
  const timer=window.setInterval(()=>{void Promise.all(items.filter(i=>i.status==="processing").map(async item=>{
   const r=await fetch("/api/influencer/content/status?id="+item.id,{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(r.ok&&d.item)setItems(all=>all.map(x=>x.id===item.id?d.item:x));
  }));},3000);return()=>window.clearInterval(timer);
 },[selected?.id,items.map(i=>i.id+":"+i.status).join("|")]);

 async function createProfile(e:FormEvent){
  e.preventDefault();setSaving(true);setError("");
  try{const r=await fetch("/api/influencer/profiles",{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({name,description:"",instagramUsername:"",postsPerDay:Number(posts)||3,postingTimes:["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"].slice(0,Number(posts)||3),captionMode:"zh_ja_random",fixedPublishTitle:name,fixedPublishDescription:"",shareToFeed:true})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível criar o perfil.");
   setProfiles(p=>[...p,d.profile]);setSelected(d.profile);setName("");setPosts("3");setShowNew(false);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao criar perfil.");}finally{setSaving(false);}
 }
 async function addUrl(e:FormEvent){
  e.preventDefault();if(!selected||!url.trim())return;setAdding(true);setError("");clearSectionError("add");
  try{const r=await fetch("/api/influencer/content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profileId:selected.id,sourceUrl:url,title:videoTitle})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível adicionar o vídeo.");setItems(v=>[d.item,...v]);setUrl("");setVideoTitle("");
  }catch(e){showSectionError("add",e instanceof Error?e.message:"Erro ao adicionar.");}finally{setAdding(false);}
 }
 async function saveProfileSettings(){
  if(!selected)return;
  setProfileSaving(true);setError("");
  try{
   const times=profileDraft.posting_times.slice(0,profileDraft.posts_per_day);
   const r=await fetch("/api/influencer/profiles",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    id:selected.id,
    posts_per_day:profileDraft.posts_per_day,
    caption_mode:profileDraft.caption_mode,
    repeat_when_exhausted:profileDraft.repeat_when_exhausted,
    posting_times:times,
    fixed_publish_title:profileDraft.fixed_publish_title,
    fixed_publish_description:profileDraft.fixed_publish_description,
    share_to_feed:profileDraft.share_to_feed
   })});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível salvar as configurações.");
   // Atualiza imediatamente o perfil exibido com o registro que acabou de ser
   // persistido. A Agenda depende de selected.posting_times, então precisamos
   // trocar o objeto selecionado no mesmo ciclo do salvamento.
   setSelected(d.profile);
   setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));
   setProfileDraft({
    posts_per_day:d.profile.posts_per_day||3,
    caption_mode:d.profile.caption_mode||"zh_ja_random",
    repeat_when_exhausted:Boolean(d.profile.repeat_when_exhausted),
    posting_times:[...(d.profile.posting_times||[])],
    fixed_publish_title:d.profile.fixed_publish_title||"",
    fixed_publish_description:d.profile.fixed_publish_description||"",
    share_to_feed:d.profile.share_to_feed!==false
   });
  }catch(e){showSectionError("profile",e instanceof Error?e.message:"Erro ao salvar as configurações.");}
  finally{setProfileSaving(false);}
 }
 const profileDirty=useMemo(()=>{
  if(!selected)return false;
  const current={
   posts_per_day:selected.posts_per_day||3,
   caption_mode:selected.caption_mode||"zh_ja_random",
   repeat_when_exhausted:Boolean(selected.repeat_when_exhausted),
   posting_times:[...(selected.posting_times||[])].slice(0,profileDraft.posts_per_day),
   fixed_publish_title:selected.fixed_publish_title||"",
   fixed_publish_description:selected.fixed_publish_description||"",
   share_to_feed:selected.share_to_feed!==false
  };
  const draft={...profileDraft,posting_times:profileDraft.posting_times.slice(0,profileDraft.posts_per_day)};
  return JSON.stringify(current)!==JSON.stringify(draft);
 },[selected,profileDraft]);
 async function uploadCover(){
  if(!selected||!coverFile)return;
  setUploadingCover(true);setError("");
  try{
   const form=new FormData();form.append("profileId",selected.id);form.append("file",coverFile);
   const controller=new AbortController();
   const timeout=window.setTimeout(()=>controller.abort(),45000);
   let r:Response;
   try { r=await fetch("/api/influencer/cover",{method:"POST",body:form,signal:controller.signal}); }
   catch(err) { throw new Error(err instanceof DOMException && err.name==="AbortError" ? "O envio da capa demorou mais de 45 segundos. Verifique o bucket influencer-covers no Supabase." : "Não foi possível enviar a capa."); }
   finally { window.clearTimeout(timeout); }
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error([d.error,d.code ? `Código: ${d.code}` : "",d.hint || ""].filter(Boolean).join(" "));
   setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));setCoverFile(null);setCoverPreviewKey(d.profile.cover_r2_key||"");setLocalCoverPreview("");
  }catch(e){showSectionError("cover",e instanceof Error?e.message:"Erro ao salvar a capa.");}finally{setUploadingCover(false);}
 }
 function handleCoverFile(file:File|null){
  if(localCoverPreview) URL.revokeObjectURL(localCoverPreview);
  setCoverFile(file);
  setLocalCoverPreview(file ? URL.createObjectURL(file) : "");
 }
 async function togglePublishing(){
  if(!selected)return;setPublishing(true);setError("");
  try{
   const action=selected.publishing_enabled?"stop":"enable-auto";
   const r=await fetch("/api/influencer/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,profileId:selected.id})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||d.message||"Não foi possível alterar a publicação.");
   if(action==="stop") {
    setSelected({...selected,publishing_enabled:false,next_publish_at:null});
    setProfiles(all=>all.map(p=>p.id===selected.id?{...p,publishing_enabled:false,next_publish_at:null}:p));
   } else {
    await loadProfiles();
    await loadItems(selected.id);
   }
  }catch(e){setError(e instanceof Error?e.message:"Erro na publicação.");}finally{setPublishing(false);}
 }
 async function publishItem(itemId:string){
  if(!selected)return;
  setPublishingItem(itemId);setError("");clearSectionError("publish");
  try{
   const r=await fetch("/api/influencer/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"publish-item",profileId:selected.id,itemId})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||d.message||"Não foi possível publicar o Reel.");
   await loadItems(selected.id);
   await loadProfiles();
  }catch(e){showSectionError("publish",e instanceof Error?e.message:"Erro ao publicar o Reel.");}
  finally{setPublishingItem(null);}
 }
 async function renameTitle(itemId:string){
  const title=titleDraft.trim();
  if(!title)return;
  setRenamingItem(itemId);setError("");
  try{
   const r=await fetch("/api/influencer/content",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:itemId,title})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível renomear o vídeo.");
   if(d.item)setItems(all=>all.map(item=>item.id===itemId?d.item:item));
   setTitleDraft("");
  }catch(e){setError(e instanceof Error?e.message:"Erro ao renomear o vídeo.");}
  finally{setRenamingItem(null);}
 }
 async function randomizeCopy(itemId:string){
  setRandomizingItem(itemId);setError("");
  try{
   const r=await fetch("/api/influencer/content",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:itemId,randomize:true})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível gerar um novo nome e descrição.");
   if(d.item)setItems(all=>all.map(item=>item.id===itemId?d.item:item));
  }catch(e){setError(e instanceof Error?e.message:"Erro ao gerar novo nome e descrição.");}
  finally{setRandomizingItem(null);}
 }
 async function deleteProfile(){
  if(!selected)return;
  if(!window.confirm(`Excluir o perfil "${selected.name}" e toda a biblioteca dele? Esta ação não pode ser desfeita.`))return;
  setSaving(true);setError("");
  try{
   const r=await fetch("/api/influencer/profiles?id="+encodeURIComponent(selected.id),{method:"DELETE"});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível excluir o perfil.");
   const remaining=profiles.filter(p=>p.id!==selected.id);
   setProfiles(remaining);setSelected(remaining[0]||null);setItems([]);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao excluir o perfil.");}
  finally{setSaving(false);}
 }
 async function shareLibrary(){
  if(!selected||!shareTargets.length)return;
  setSharing(true);setError("");
  try{
   const r=await fetch("/api/influencer/content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"share-library",profileId:selected.id,targetProfileIds:shareTargets})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível compartilhar a biblioteca.");
   setShareTargets([]);
   setShareOpen(false);
   await loadItems(selected.id);
  }catch(e){showSectionError("share",e instanceof Error?e.message:"Erro ao compartilhar a biblioteca.");}
  finally{setSharing(false);}
 }
 async function removeItem(id:string){
  const item=items.find(i=>i.id===id);if(!item)return;
  if(!window.confirm(item.status==="processing"?"Cancelar o processamento deste vídeo?":"Excluir este vídeo da biblioteca deste perfil? O arquivo armazenado será removido e esta ação não pode ser desfeita."))return;
  const r=await fetch("/api/influencer/content?id="+encodeURIComponent(id)+(item.share_id?"&shareId="+encodeURIComponent(item.share_id):""),{method:"DELETE"}),d=await r.json().catch(()=>({}));
  if(r.ok)setItems(v=>v.filter(i=>i.id!==id));else setError(d.error||"Não foi possível excluir o conteúdo.");
 }
 const available=useMemo(()=>items.filter(i=>i.status==="available").length,[items]);

 const published=useMemo(()=>items.filter(i=>i.status==="published").length,[items]);
 const failed=useMemo(()=>items.filter(i=>i.status==="failed").length,[items]);
 const formatDate=(value:string|null|undefined)=>{if(!value)return "—";try{return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Cuiaba"}).format(new Date(value));}catch{return "—";}};
 const expiresSoon=Boolean(instagramExpiresAt&&new Date(instagramExpiresAt).getTime()-Date.now()<7*24*60*60*1000);
 const queuePreview=useMemo(()=>{
  if(!selected)return [];
  // A agenda usa o rascunho atualmente exibido. Assim, depois de salvar uma
  // alteração como 19:00 -> 20:00, o horário visual é atualizado imediatamente
  // sem depender de uma segunda leitura do perfil selecionado.
  const configuredTimes=profileDraft.posting_times||[];
  const times=configuredTimes.filter((v)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)).sort();
  const fallback=["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"];
  const slots=times.length?times:Array.from({length:profileDraft.posts_per_day},(_,i)=>fallback[i]||"09:00");
  const availableItems=items.filter((item)=>item.status==="available").sort((a,b)=>String(a.created_at||"").localeCompare(String(b.created_at||"")));
  const publishedItems=items.filter((item)=>item.status==="published").sort((a,b)=>String(a.published_at||a.created_at).localeCompare(String(b.published_at||b.created_at)));
  const repeat=Boolean(profileDraft.repeat_when_exhausted);
  const anchor=new Date();
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Cuiaba",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(anchor);
  const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value||0);
  const localAnchor={year:get("year"),month:get("month"),day:get("day"),hour:get("hour"),minute:get("minute")};
  const localToUtc=(year:number,month:number,day:number,hour:number,minute:number)=>{
    let guess=Date.UTC(year,month-1,day,hour,minute,0,0);
    for(let i=0;i<3;i++){
      const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/Cuiaba",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));
      const value=(type:string)=>Number(p.find(part=>part.type===type)?.value||0);
      guess+=Date.UTC(year,month-1,day,hour,minute)-Date.UTC(value("year"),value("month")-1,value("day"),value("hour"),value("minute"));
    }
    return new Date(guess);
  };
  const base=Date.UTC(localAnchor.year,localAnchor.month-1,localAnchor.day);
  const initialQueue=repeat?[...availableItems,...publishedItems]:availableItems;
  if(!initialQueue.length)return [];
  const repeatPool=publishedItems;
  const maxSlots=slots.length*7;
  const out:{day:number;time:string;item:Item|null}[]=[];
  for(let day=0;day<7&&out.length<maxSlots;day++){
    const date=new Date(base+day*24*60*60*1000);
    const year=date.getUTCFullYear(),month=date.getUTCMonth()+1,dom=date.getUTCDate();
    for(const time of slots){
      if(out.length>=maxSlots)break;
      const [hour,minute]=time.split(":").map(Number);
      const candidate=localToUtc(year,month,dom,hour,minute);
      if(candidate.getTime()<anchor.getTime())continue;
      let item:Item|null=null;
      if(out.length<initialQueue.length)item=initialQueue[out.length]||null;
      else if(repeat&&repeatPool.length)item=repeatPool[(out.length-initialQueue.length)%repeatPool.length]||null;
      else return out;
      if(item)out.push({day,time,item});
    }
  }
  return out;
 },[items,selected,profileDraft.posting_times,profileDraft.posts_per_day,profileDraft.repeat_when_exhausted]);

 return (<main className="im-page">
  <header className="im-header"><div className="im-header-copy"><a className="im-back" href="/">← Clip Factory</a><span className="im-header-label">INFLUENCER MANAGER</span><h1>Transforme ideias<br /><em>em influência.</em></h1><p>Organize bibliotecas, padronize seus perfis e automatize a publicação dos seus Reels.</p><div className="im-hero-pills"><span>BIBLIOTECA</span><span>AUTOMAÇÃO</span><span>REELS 9:16</span></div></div><div className="im-hero-mark-wrap"><div className="im-hero-mark"><strong>IG</strong><span>INFLUENCER</span></div><div className="im-hero-orbit im-orbit-one" /><div className="im-hero-orbit im-orbit-two" /></div><div className="im-header-actions"><button className="im-ghost im-profiles-trigger" onClick={()=>setShowProfiles(true)}>SEUS PERFIS <b>{profiles.length}</b></button><button className="im-primary" onClick={()=>setShowNew(true)}>+ Novo perfil</button></div></header>
  {showNew&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-label="Criar novo perfil"><div className="im-modal im-new-profile-modal">
   <div className="im-card-head"><div><span className="im-kicker">NOVO PERFIL</span><h2>Criar perfil</h2><p>Crie o perfil primeiro. Depois você poderá conectar o Instagram e configurar a publicação.</p></div><button className="im-ghost" type="button" onClick={()=>setShowNew(false)}>Fechar</button></div>
   <form className="im-form im-new-profile-form" onSubmit={createProfile}>
    <label>Nome do perfil<input value={name} onChange={e=>setName(e.target.value)} placeholder="Memes BR" required /></label>
    <label>Reels por dia<select className="im-form-select" value={posts} onChange={e=>setPosts(e.target.value)}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
    <div className="im-form-note">O Instagram será conectado depois que o perfil for criado.</div>
    <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowNew(false)}>Cancelar</button><button className="im-primary" disabled={saving}>{saving?"Criando…":"Criar perfil"}</button></div>
   </form>
  </div></div>}
  <section className="im-layout">
   <button type="button" className="im-mobile-profile-trigger" onClick={()=>setShowProfiles(true)}>SEUS PERFIS <b>{profiles.length}</b></button>

   <section className="im-main">{!selected?<div className="im-card im-empty-main"><strong>Crie um perfil para começar.</strong><span>Depois, adicione URLs de vídeos.</span></div>:<>
    <div className="im-card im-overview"><div><span className="im-kicker">PERFIL ATIVO</span><h2>{selected.name}</h2><p>{selected.instagram_username?"@"+selected.instagram_username:"Conecte um Instagram para publicar automaticamente."}</p></div><div className="im-overview-actions"><button className="im-ghost im-danger" disabled={saving} onClick={()=>void deleteProfile()}>Excluir perfil</button></div></div>
    <div className="im-card im-account"><div className="im-card-head"><div><span className="im-kicker">CONTA VINCULADA </span><h2>Instagram</h2><p>Conta vinculada somente a este perfil.</p></div><span className={"im-status "+(instagramConnected?"available":"archived")}>{instagramReconnect?"RECONEXÃO NECESSÁRIA":instagramConnected?"CONECTADO":"NÃO CONECTADO"}</span></div><div className="im-account-row"><div><strong>{instagramAccount||"Nenhuma conta Instagram conectada"}</strong>{instagramExpiresAt&&<small className="im-field-help">Token válido até {formatDate(instagramExpiresAt)}{expiresSoon?" · renovação necessária em breve":""}</small>}</div>{(!instagramConnected||instagramReconnect)&&<a className="im-ghost" href={"/api/influencer/instagram/oauth?profileId="+encodeURIComponent(selected.id)}>{instagramReconnect?"Reconectar Instagram":"Conectar Instagram"}</a>}{(instagramConnected||instagramReconnect)&&<button type="button" className="im-ghost im-danger" disabled={saving} onClick={()=>void disconnectInstagram()}>Desvincular Instagram</button>}</div></div>

    <div className="im-card im-profile-config">
      <div className="im-card-head">
        <div><span className="im-kicker">CONFIGURAÇÃO DO PERFIL </span><h2>Identidade e publicação</h2><p>Identidade, dados dos Reels e regras de publicação.</p></div>
      </div>

       <div className="im-config-section">
         <div className="im-config-section-head"><div><span className="im-kicker">IDENTIDADE </span><h3>Capa do perfil</h3><p>Capa usada nos Reels deste perfil.</p></div><span className={selected.cover_r2_key?"im-cover-ok":"im-status archived"}>{selected.cover_r2_key?"CONFIGURADA":"NÃO CONFIGURADA"}</span></div>
         <div className="im-cover-upload">
           <label>Arquivo da capa<input key={selected.id} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>handleCoverFile(e.target.files?.[0]||null)} /></label>
           <div className="im-cover-row">
             <div className="im-cover-frame">{(localCoverPreview||coverPreviewUrl)?<img className="im-cover-preview" src={localCoverPreview||coverPreviewUrl} alt={`Capa de ${selected.name}`} />:<div className="im-cover-empty"><span>9:16</span><small>PRÉVIA DA CAPA</small></div>}<div className="im-cover-frame-glow" /></div>
             <div className="im-cover-meta"><strong>{coverFile?coverFile.name:selected.cover_r2_key?"Capa configurada":"Escolha uma capa vertical"}</strong><span>Capa usada nos Reels deste perfil.</span><button type="button" className="im-primary" disabled={!coverFile||uploadingCover} onClick={()=>void uploadCover()}>{uploadingCover?"Enviando…":"Salvar capa"}</button></div>
           </div>
           <small>JPG, PNG ou WEBP · até 5 MB.</small>
         </div>
       </div>

       <div className="im-config-section">

        <div className="im-config-section-head"><div><span className="im-kicker">IDENTIDADE DO REEL </span><h3>Nome e descrição</h3><p>Nome e descrição podem ser automáticos.</p></div><span className={profileDraft.fixed_publish_title&&profileDraft.fixed_publish_description?"im-cover-ok":"im-status archived"}>{profileDraft.fixed_publish_title&&profileDraft.fixed_publish_description?"FIXO":"FLEXÍVEL"}</span></div>
        <div className="im-fixed-copy">
          <label>Nome do Reel <span className="im-field-help">Deixe vazio para gerar automaticamente.</span><input value={profileDraft.fixed_publish_title} onChange={e=>setProfileDraft(v=>({...v,fixed_publish_title:e.target.value}))} placeholder="Automático" /></label>
          <label>Descrição <span className="im-field-help"></span><textarea rows={5} value={profileDraft.fixed_publish_description} onChange={e=>setProfileDraft(v=>({...v,fixed_publish_description:e.target.value}))} placeholder="Automática em chinês/japonês" /></label>
        </div>        <label className="im-check"><input type="checkbox" checked={profileDraft.share_to_feed} onChange={e=>setProfileDraft(v=>({...v,share_to_feed:e.target.checked}))}/><span>Publicar também na Grade Principal do Instagram</span></label>
      </div>

      <div className="im-config-section">
        <div className="im-config-section-head"><div><span className="im-kicker">PUBLICAÇÃO </span><h3>Regras e horários</h3><p>Frequência, horários e fila de publicação.</p></div><span className={"im-status "+(selected.publishing_enabled?"available":"archived")}>{selected.publishing_enabled?"EXECUTANDO":"PARADA"}</span></div>
        <div className="im-settings-grid">
          <label>Reels por dia<select className="im-form-select" value={profileDraft.posts_per_day} onChange={e=>setProfileDraft(v=>({...v,posts_per_day:Number(e.target.value)}))}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
          <label>Descrição<select className="im-form-select" value={profileDraft.caption_mode} onChange={e=>setProfileDraft(v=>({...v,caption_mode:e.target.value}))}><option value="zh_ja_random">Chinês + Japonês aleatório</option><option value="zh_random">Chinês</option><option value="ja_random">Japonês</option><option value="custom">Banco personalizado</option></select></label>
        </div>
        <div className="im-times"><span className="im-kicker">HORÁRIOS DIÁRIOS</span><div className="im-time-grid">{Array.from({length:profileDraft.posts_per_day},(_,i)=><label key={i}>Post {i+1}<input type="time" value={profileDraft.posting_times?.[i]||["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"][i]} onChange={e=>setProfileDraft(v=>{const times=[...v.posting_times];while(times.length<v.posts_per_day)times.push("");times[i]=e.target.value;return {...v,posting_times:times};})} /></label>)}</div><small></small></div>
        <div className="im-publish-controls">
          <button className="im-primary" disabled={publishing||selected.publishing_enabled} onClick={()=>void togglePublishing()}>{publishing?"Ativando…":"▶ Ativar publicação automática"}</button>
          <button className="im-ghost" disabled={publishing||!selected.publishing_enabled} onClick={()=>void togglePublishing()}>■ Desativar publicação</button>
          <label className="im-check im-repeat-toggle"><input type="checkbox" checked={profileDraft.repeat_when_exhausted} onChange={e=>setProfileDraft(v=>({...v,repeat_when_exhausted:e.target.checked}))}/><span>Repetir biblioteca quando acabar</span></label>
        </div>
        <div className="im-profile-save"><button className="im-primary" type="button" disabled={!profileDirty||profileSaving} onClick={()=>void saveProfileSettings()}>{profileSaving?"Salvando…":"Salvar alterações"}</button></div>
      </div>
    </div>

    {feedbackMessage&&<div className="im-modal-backdrop im-feedback-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="im-feedback-title">
      <div className="im-modal im-feedback-modal">
        <div className="im-feedback-icon">!</div>
        <div className="im-feedback-copy"><span className="im-kicker">ATENÇÃO</span><h2 id="im-feedback-title">Não foi possível concluir</h2><p>{feedbackMessage}</p></div>
        <button className="im-primary" type="button" onClick={()=>{setError("");setInlineError(null);}}>Entendi</button>
      </div>
    </div>}<div className="im-card im-add"><div className="im-card-head"><div><span className="im-kicker">CONTEÚDO </span><h2>Adicionar vídeo</h2><p>Adicione um vídeo por URL.</p></div></div>
     <form className="im-url-form" onSubmit={addUrl}><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://youtube.com/... ou https://instagram.com/reel/..." required /><input value={videoTitle} onChange={e=>setVideoTitle(e.target.value)} placeholder="Título do vídeo (opcional)" maxLength={500} /><button className="im-primary" disabled={adding}>{adding?"Processando…":"Adicionar vídeo"}</button></form>
    </div>

    <div className="im-card im-agenda">
      <div className="im-card-head">
        <div><span className="im-kicker">AGENDA E HISTÓRICO </span><h2>Publicações</h2><p>Fila e histórico de publicações.</p></div>
      </div>
      <div className="im-agenda-grid">
        <div className="im-agenda-column">
          <div className="im-agenda-title"><strong>Próximos horários</strong><span>{queuePreview.length} na fila</span></div>
          {!selected.publishing_enabled ? <div className="im-agenda-empty"><strong>Publicação automática desativada</strong><span>Ative a publicação automática para visualizar a próxima sequência.</span></div> : queuePreview.length===0 ? <div className="im-agenda-empty"><strong>Nenhum vídeo disponível para a fila</strong><span>{profileDraft.repeat_when_exhausted ? "A biblioteca será repetida quando houver conteúdo publicado." : "Todos os vídeos disponíveis já foram publicados. Ative a repetição da biblioteca para reutilizá-los."}</span></div> : <div className="im-agenda-list">{queuePreview.slice(0,6).map((slot,index)=>{const postNumber=published+index+1;return <div className={"im-agenda-row "+(index===0?"is-next":"")} key={slot.day+"-"+slot.time+"-"+(slot.item?.id||index)}><span>{index===0?"PRÓXIMO #"+postNumber:"#"+postNumber}</span><strong>{slot.time}</strong><small>{slot.item?.title||"Próximo vídeo"}</small></div>})}</div>}
        </div>
        <div className="im-agenda-column">
          <div className="im-agenda-title"><strong>Últimas publicações</strong><span>{published} publicadas</span></div>
          {published===0 ? <div className="im-agenda-empty">Ainda não há publicações registradas.</div> : <div className="im-agenda-list">{items.filter(i=>i.status==="published").sort((a,b)=>String(b.published_at||b.created_at).localeCompare(String(a.published_at||a.created_at))).slice(0,6).map(item=><div className="im-agenda-row" key={"history-"+item.id}><span>PUBLICADO</span><strong>{formatDate(item.published_at||item.created_at)}</strong><small>{item.title||"Vídeo sem título"}</small></div>)}</div>}
        </div>
      </div>
    </div>

    <div className="im-card im-library">
      <div className="im-card-head">
        <div>
          <span className="im-kicker">BIBLIOTECA </span>
          <h2>Biblioteca de conteúdo</h2>
          <p>Conteúdo próprio e bibliotecas compartilhadas ficam separados.</p>
        </div>
        <div className="im-library-head-actions">
          <span className="im-count">{items.length}</span>
          <button className="im-ghost" onClick={() => { setShareOpen(true); }} disabled={profiles.length < 2}>Gerenciar compartilhamento</button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="im-empty">Nenhum vídeo cadastrado.</div>
      ) : (
        <>
          {items.filter(item => item.shared).length > 0 && (
            <>
              <div className="im-library-section-title">
                <span>CONTEÚDO COMPARTILHADO</span>
                <small>Vídeos disponibilizados por outros perfis</small>
              </div>
              <div className="im-items">
                {items.filter(item => item.shared).map(item => (
                  <article className={"im-item "+(item.status==="available"?"im-item-ready":"")+" "+(item.status==="published"?"im-item-published":"")} key={item.id + ":" + (item.share_id || "shared")}>
                    <div className="im-item-main">
                      <span>Biblioteca de {item.source_profile_name || "outro perfil"}</span>
                      {item.result_url && <video className="im-video-preview" src={item.result_url} controls preload="metadata" />}
                      <div className="im-reel-copy">
                        <label>Nome do Reel<strong>{item.publish_title || "—"}</strong></label>
                        <label>Descrição do Reel<strong>{item.publish_description || "—"}</strong></label>
                      </div>
                      {item.error_message && <small className="im-error-text">{item.error_message}</small>}
                    </div>
                    <div className="im-item-actions">
                      <span className={"im-status " + item.status}>{STATUS[item.status] || item.status}</span>
                      {item.result_url && <a className="im-ghost" href={item.result_url} target="_blank" rel="noreferrer">Abrir vídeo</a>}
                      {item.status === "available" && (
                        <button className="im-primary im-publish-item" disabled={publishingItem === item.id} onClick={() => void publishItem(item.id)}>
                          {publishingItem === item.id ? "Publicando…" : "Publicar Reel"}
                        </button>
                      )}
                      {item.share_id && <button className="im-ghost" onClick={() => void removeItem(item.id)}>Remover do perfil</button>}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {items.filter(item => !item.shared).length > 0 && (
            <>
              <div className="im-library-section-title">
                <span>MEU CONTEÚDO</span>
                <small>{items.filter(item => !item.shared).length} vídeos criados por {selected.name}</small>
              </div>
              <div className="im-items">
                {items.filter(item => !item.shared).map(item => (
                  <article className={"im-item "+(item.status==="available"?"im-item-ready":"")+" "+(item.status==="published"?"im-item-published":"")} key={item.id}>
                    <div className="im-item-main">
                      <span>{item.source_url}</span>
                      {item.status === "processing" && (
                        <div className="im-progress">
                          <div><span style={{ width: (item.progress || 5) + "%" }} /></div>
                          <small>{item.progress || 5}% · {item.stage === "download" ? "Baixando" : item.stage === "render" ? "Convertendo para 9:16" : item.stage === "upload" ? "Enviando para R2" : "Preparando worker"}</small>
                        </div>
                      )}
                      {item.error_message && <small className="im-error-text">{item.error_message}</small>}
                      {item.result_url && <video className="im-video-preview" src={item.result_url} controls preload="metadata" />}
                      {(item.publish_title || item.publish_description) && (
                        <div className="im-reel-copy">
                          <label>Nome do Reel<strong>{item.publish_title || "—"}</strong></label>
                          <label>Descrição do Reel<strong>{item.publish_description || "—"}</strong></label>
                        </div>
                      )}
                    </div>
                    <div className="im-item-actions">
                      <span className={"im-status " + item.status}>{item.shared ? "COMPARTILHADO" : STATUS[item.status] || item.status}</span>
                      {item.status === "processing" ? (
                        <button className="im-ghost" onClick={() => void removeItem(item.id)}>Cancelar</button>
                      ) : item.result_url ? (
                        <a className="im-ghost" href={item.result_url} target="_blank" rel="noreferrer">Abrir vídeo</a>
                      ) : null}
                      {item.status !== "processing" && item.status !== "failed" && (
                        <button className="im-ghost" disabled={randomizingItem === item.id} onClick={() => void randomizeCopy(item.id)}>
                          {randomizingItem === item.id ? "Gerando…" : "↻ Nome + descrição"}
                        </button>
                      )}
                      {item.status === "available" && (
                        <button className="im-primary im-publish-item" disabled={publishingItem === item.id} onClick={() => void publishItem(item.id)}>
                          {publishingItem === item.id ? "Publicando…" : "Publicar Reel"}
                        </button>
                      )}
                      {item.status !== "processing" && (
                        <button className="im-ghost im-delete-item" onClick={() => void removeItem(item.id)}>Excluir vídeo</button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
</>}
  </section>


  </section>
  {showProfiles&&<div className="im-modal-backdrop im-profiles-modal" role="dialog" aria-modal="true" aria-label="Seus perfis"><div className="im-modal im-profiles-modal-card"><div className="im-card-head"><div><span className="im-kicker">SEUS PERFIS</span><h2>Escolha um perfil</h2><p>Selecione o perfil que você quer gerenciar.</p></div><button className="im-ghost" onClick={()=>setShowProfiles(false)}>Fechar</button></div>{loading?<div className="im-empty">Carregando…</div>:profiles.length===0?<div className="im-empty">Crie seu primeiro perfil para começar.</div>:<div className="im-profile-modal-list">{profiles.map(p=><button key={p.id} className={"im-profile "+(selected?.id===p.id?"active":"")} onClick={()=>{setSelected(p);setShowProfiles(false)}}><span className="im-avatar">{p.name.slice(0,1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{p.instagram_username?"@"+p.instagram_username:"Instagram não conectado"}</small></span><b>{p.posts_per_day}/dia</b></button>)}</div>}<button className="im-primary im-modal-new-profile" onClick={()=>{setShowProfiles(false);setShowNew(true)}}>+ Novo perfil</button></div></div>}
  {shareOpen&&<div className="im-modal-backdrop" role="dialog" aria-modal="true"><div className="im-modal"><div className="im-card-head"><div><span className="im-kicker">BIBLIOTECA COMPARTILHADA</span><h2>Compartilhar biblioteca</h2><p>Selecione os perfis que devem receber esta biblioteca. Perfis já compartilhados aparecem abaixo, com opção de descompartilhar.</p></div><button className="im-ghost" onClick={()=>setShareOpen(false)}>Fechar</button></div><div className="im-share-list">{profiles.filter(p=>p.id!==selected?.id && !sharedWith.includes(p.id)).map(p=><label key={p.id} className="im-check"><input type="checkbox" checked={shareTargets.includes(p.id)} onChange={e=>setShareTargets(v=>e.target.checked?[...v,p.id]:v.filter(id=>id!==p.id))}/><span>{p.name} {p.instagram_username?("· @"+p.instagram_username.replace(/^@/,"")):""}</span></label>)}</div><div className="im-share-current"><strong>Bibliotecas atualmente compartilhadas</strong>{sharedWith.length===0?<p className="im-field-help">Nenhuma biblioteca compartilhada com outro perfil.</p>:profiles.filter(p=>sharedWith.includes(p.id)).map(p=><div key={"current-"+p.id} className="im-share-current-row"><span>{p.name}</span><button className="im-ghost" disabled={sharing} onClick={async()=>{setSharing(true);setError("");try{const r=await fetch("/api/influencer/content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"unshare-library",profileId:selected?.id,targetProfileId:p.id})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível descompartilhar a biblioteca.");await loadItems(selected!.id);}catch(e){setError(e instanceof Error?e.message:"Erro ao descompartilhar.");}finally{setSharing(false);}}}>Descompartilhar</button></div>)}</div><div className="im-modal-actions"><button className="im-primary" disabled={sharing||!shareTargets.length} onClick={()=>void shareLibrary()}>{sharing?"Compartilhando…":"Compartilhar biblioteca"}</button></div></div></div>} </main>);
}