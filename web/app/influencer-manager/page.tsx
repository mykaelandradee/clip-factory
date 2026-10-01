"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Profile={
  id:string; name:string; instagram_username:string|null; posts_per_day:number;
  posting_times:string[]; caption_mode:string; auto_publish:boolean;
  repeat_when_exhausted:boolean; cover_r2_key?:string|null; publishing_enabled?:boolean; next_publish_at?:string|null;
};
type Item={
  id:string; source_url:string; title:string|null; status:string; created_at:string;
  result_url?:string|null; r2_key?:string|null; publish_title?:string|null;
  publish_description?:string|null; source_description?:string|null;
  error_message?:string|null; progress?:number; stage?:string|null;
};
const STATUS:Record<string,string>={queued:"Na fila",processing:"Processando",available:"Disponível",scheduled:"Publicando",published:"Publicado",failed:"Erro",archived:"Arquivado"};

export default function InfluencerManagerPage(){
 const [profiles,setProfiles]=useState<Profile[]>([]),[selected,setSelected]=useState<Profile|null>(null),[items,setItems]=useState<Item[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const [showNew,setShowNew]=useState(false),[name,setName]=useState(""),[instagram,setInstagram]=useState(""),[posts,setPosts]=useState("3");
 const [url,setUrl]=useState(""),[adding,setAdding]=useState(false),[publishing,setPublishing]=useState(false),[coverFile,setCoverFile]=useState<File|null>(null),[uploadingCover,setUploadingCover]=useState(false);

 async function loadProfiles(){
  setLoading(true);setError("");
  try{const r=await fetch("/api/influencer/profiles",{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível carregar os perfis.");
   setProfiles(d.profiles||[]);setSelected(c=>c?(d.profiles||[]).find((p:Profile)=>p.id===c.id)||null:(d.profiles||[])[0]||null);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar.");}finally{setLoading(false);}
 }
 async function loadItems(id:string){
  try{const r=await fetch("/api/influencer/content?profileId="+encodeURIComponent(id),{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível carregar a biblioteca.");setItems(d.items||[]);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar a biblioteca.");}
 }
 useEffect(()=>{void loadProfiles();},[]);
 useEffect(()=>{if(selected)void loadItems(selected.id);else setItems([]);},[selected?.id]);
 useEffect(()=>{if(!selected||!items.some(i=>i.status==="processing"))return;
  const timer=window.setInterval(()=>{void Promise.all(items.filter(i=>i.status==="processing").map(async item=>{
   const r=await fetch("/api/influencer/content/status?id="+item.id,{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(r.ok&&d.item)setItems(all=>all.map(x=>x.id===item.id?d.item:x));
  }));},3000);return()=>window.clearInterval(timer);
 },[selected?.id,items.map(i=>i.id+":"+i.status).join("|")]);

 async function createProfile(e:FormEvent){
  e.preventDefault();setSaving(true);setError("");
  try{const r=await fetch("/api/influencer/profiles",{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({name,instagramUsername:instagram,postsPerDay:Number(posts),postingTimes:[],captionMode:"zh_ja_random"})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível criar o perfil.");
   setProfiles(p=>[...p,d.profile]);setSelected(d.profile);setName("");setInstagram("");setPosts("3");setShowNew(false);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao criar perfil.");}finally{setSaving(false);}
 }
 async function addUrl(e:FormEvent){
  e.preventDefault();if(!selected||!url.trim())return;setAdding(true);setError("");
  try{const r=await fetch("/api/influencer/content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profileId:selected.id,sourceUrl:url})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível adicionar o vídeo.");setItems(v=>[d.item,...v]);setUrl("");
  }catch(e){setError(e instanceof Error?e.message:"Erro ao adicionar.");}finally{setAdding(false);}
 }
 async function updateProfile(patch:Record<string,unknown>){
  if(!selected)return;const r=await fetch("/api/influencer/profiles",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:selected.id,...patch})}),d=await r.json().catch(()=>({}));
  if(!r.ok){setError(d.error||"Não foi possível salvar.");return;}
  setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));
 }
 async function uploadCover(){
  if(!selected||!coverFile)return;
  setUploadingCover(true);setError("");
  try{
   const form=new FormData();form.append("profileId",selected.id);form.append("file",coverFile);
   const r=await fetch("/api/influencer/cover",{method:"POST",body:form});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível salvar a capa.");
   setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));setCoverFile(null);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao salvar a capa.");}finally{setUploadingCover(false);}
 }
 async function togglePublishing(){
  if(!selected)return;setPublishing(true);setError("");
  try{
   const action=selected.publishing_enabled?"stop":"start";
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
 async function removeItem(id:string){
  const item=items.find(i=>i.id===id);if(!item)return;
  if(!window.confirm(item.status==="processing"?"Cancelar o processamento deste vídeo?":"Remover este vídeo da biblioteca?"))return;
  const r=await fetch("/api/influencer/content?id="+encodeURIComponent(id),{method:"DELETE"}),d=await r.json().catch(()=>({}));
  if(r.ok)setItems(v=>v.filter(i=>i.id!==id));else setError(d.error||"Não foi possível excluir o conteúdo.");
 }
 const available=useMemo(()=>items.filter(i=>i.status==="available").length,[items]);
 const days=selected&&selected.posts_per_day?Math.floor(available/selected.posts_per_day):0;

 return <main className="im-page">
  <header className="im-header"><div><a className="im-back" href="/">← Clip Factory</a><span className="im-kicker">INFLUENCER MANAGER</span><h1>Influencer Manager</h1><p>Biblioteca, vídeos 9:16 e automação de publicação.</p></div><button className="im-primary" onClick={()=>setShowNew(true)}>+ Novo perfil</button></header>
  {error&&<div className="im-alert">{error}</div>}
  {showNew&&<section className="im-card im-form-card"><div className="im-card-head"><div><span className="im-kicker">NOVO PERFIL</span><h2>Criar perfil</h2></div><button className="im-ghost" onClick={()=>setShowNew(false)}>Fechar</button></div>
   <form className="im-form" onSubmit={createProfile}><label>Nome do perfil<input value={name} onChange={e=>setName(e.target.value)} placeholder="Memes BR" required /></label><label>Instagram<input value={instagram} onChange={e=>setInstagram(e.target.value)} placeholder="@meuperfil" /></label><label>Reels por dia<input type="number" min="1" max="9" value={posts} onChange={e=>setPosts(e.target.value)} /></label><button className="im-primary" disabled={saving}>{saving?"Criando…":"Criar perfil"}</button></form>
  </section>}
  <section className="im-layout">
   <aside className="im-sidebar"><div className="im-side-head"><span>SEUS PERFIS</span><strong>{profiles.length}</strong></div>{loading?<div className="im-empty">Carregando…</div>:profiles.length===0?<div className="im-empty">Crie seu primeiro perfil para começar.</div>:profiles.map(p=><button key={p.id} className={"im-profile "+(selected?.id===p.id?"active":"")} onClick={()=>setSelected(p)}><span className="im-avatar">{p.name.slice(0,1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{p.instagram_username?"@"+p.instagram_username:"Instagram não conectado"}</small></span><b>{p.posts_per_day}/dia</b></button>)}</aside>
   <section className="im-main">{!selected?<div className="im-card im-empty-main"><strong>Crie um perfil para começar.</strong><span>Depois, adicione URLs de vídeos.</span></div>:<>
    <div className="im-card im-overview"><div><span className="im-kicker">PERFIL ATIVO</span><h2>{selected.name}</h2><p>{selected.instagram_username?"@"+selected.instagram_username:"Conecte um Instagram para publicar automaticamente."}</p></div><div className="im-stats"><div><strong>{items.length}</strong><span>vídeos</span></div><div><strong>{available}</strong><span>prontos</span></div><div><strong>{days}</strong><span>dias</span></div></div></div>

    <div className="im-card im-add"><div className="im-card-head"><div><span className="im-kicker">BIBLIOTECA</span><h2>Adicionar vídeo</h2><p>Cole uma URL. O vídeo será baixado uma vez, convertido para 9:16 e salvo no R2.</p></div></div>
     <form className="im-url-form" onSubmit={addUrl}><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." required /><button className="im-primary" disabled={adding}>{adding?"Processando…":"Adicionar vídeo"}</button></form>
    </div>

    <div className="im-card im-settings"><div className="im-card-head"><div><span className="im-kicker">PUBLICAÇÃO</span><h2>Controle da publicação</h2><p>Execute para começar a publicar a biblioteca. Pare para interromper a fila.</p></div>
      <span className={"im-status "+(selected.publishing_enabled?"available":"archived")}>{selected.publishing_enabled?"EXECUTANDO":"PARADA"}</span></div>
      <div className="im-settings-grid"><label>Reels por dia<select value={selected.posts_per_day} onChange={e=>void updateProfile({posts_per_day:Number(e.target.value)})}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
       <label>Descrição<select value={selected.caption_mode} onChange={e=>void updateProfile({caption_mode:e.target.value})}><option value="zh_ja_random">Chinês + Japonês aleatório</option><option value="zh_random">Chinês</option><option value="ja_random">Japonês</option><option value="custom">Banco personalizado</option></select></label>
      </div>
      <div className="im-publish-controls"><button className="im-primary" disabled={publishing||selected.publishing_enabled} onClick={()=>void togglePublishing()}>{publishing?"Iniciando…":"▶ Executar publicação"}</button><button className="im-ghost" disabled={publishing||!selected.publishing_enabled} onClick={()=>void togglePublishing()}>■ Parar publicação</button></div>
      <div className="im-times"><span className="im-kicker">HORÁRIOS DIÁRIOS</span><div className="im-time-grid">{Array.from({length:selected.posts_per_day},(_,i)=><label key={i}>Post {i+1}<input type="time" value={selected.posting_times?.[i]||["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"][i]} onChange={e=>{const times=[...(selected.posting_times||[])];while(times.length<selected.posts_per_day)times.push("");times[i]=e.target.value;void updateProfile({posting_times:times});}} /></label>)}</div><small>O primeiro Reel é publicado ao executar. Depois, a fila segue os horários definidos.</small></div>
    </div>

    <div className="im-card im-cover-card">
      <div className="im-card-head"><div><span className="im-kicker">IDENTIDADE</span><h2>Capa do perfil</h2><p>Uma única capa fixa será reutilizada nos Reels publicados por este perfil.</p></div><span className={selected.cover_r2_key?"im-cover-ok":"im-status archived"}>{selected.cover_r2_key?"CONFIGURADA":"NÃO CONFIGURADA"}</span></div>
      <div className="im-cover-upload">
        <label>Capa fixa<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setCoverFile(e.target.files?.[0]||null)} /></label>
        <div className="im-cover-row"><span>{coverFile?coverFile.name:selected.cover_r2_key?"Capa salva no perfil":"Nenhuma capa selecionada"}</span><button type="button" className="im-primary" disabled={!coverFile||uploadingCover} onClick={()=>void uploadCover()}>{uploadingCover?"Enviando…":"Salvar capa"}</button></div>
        <small>JPG, PNG ou WEBP · máximo 5 MB.</small>
      </div>
    </div>

    <div className="im-card im-library"><div className="im-card-head"><div><span className="im-kicker">CONTEÚDO</span><h2>Biblioteca</h2></div><span className="im-count">{items.length}</span></div>
     {items.length===0?<div className="im-empty">Nenhum vídeo cadastrado.</div>:<div className="im-items">{items.map(item=><article className="im-item" key={item.id}><div className="im-item-main">
       <strong>{item.title||"Vídeo sem título"}</strong><span>{item.source_url}</span>
       {item.status==="processing"&&<div className="im-progress"><div><span style={{width:(item.progress||5)+"%"}} /></div><small>{item.progress||5}% · {item.stage==="download"?"Baixando":item.stage==="render"?"Convertendo para 9:16":item.stage==="upload"?"Enviando para R2":"Preparando worker"}</small></div>}
       {item.error_message&&<small className="im-error-text">{item.error_message}</small>}
       {item.result_url&&<video className="im-video-preview" src={item.result_url} controls preload="metadata" />}
       {(item.publish_title||item.publish_description)&&<div className="im-reel-copy"><label>Nome do Reel<strong>{item.publish_title||"—"}</strong></label><label>Descrição para publicação<strong>{item.publish_description||"—"}</strong></label></div>}
       {item.source_description&&<div className="im-source-copy"><label>Descrição original do vídeo</label><p>{item.source_description}</p></div>}
      </div><div className="im-item-actions"><span className={"im-status "+item.status}>{STATUS[item.status]||item.status}</span>{item.status==="processing"?<button className="im-ghost" onClick={()=>void removeItem(item.id)}>Cancelar</button>:item.result_url?<a className="im-ghost" href={item.result_url} target="_blank" rel="noreferrer">Abrir vídeo</a>:null}{item.status!=="processing"&&item.status!=="published"&&<button className="im-ghost" onClick={()=>void removeItem(item.id)}>Excluir</button>}</div></article>)}</div>}
    </div>
   </>}</section>
  </section>
 </main>;
}
