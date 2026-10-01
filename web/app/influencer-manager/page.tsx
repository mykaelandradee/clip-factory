"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Profile={
  id:string; name:string; description?:string|null; instagram_username:string|null; posts_per_day:number;
  posting_times:string[]; caption_mode:string; auto_publish:boolean;
  repeat_when_exhausted:boolean; cover_r2_key?:string|null; fixed_publish_title?:string|null; fixed_publish_description?:string|null; share_to_feed?:boolean; publishing_enabled?:boolean; next_publish_at?:string|null;
};
type Item={
  id:string; source_url:string; title:string|null; status:string; created_at:string; share_id?:string|null; shared?:boolean;
  r2_key?:string|null; result_url?:string|null; publish_title?:string|null;
  publish_description?:string|null; source_description?:string|null;
  error_message?:string|null; progress?:number; stage?:string|null; source_profile_id?:string|null; source_profile_name?:string|null;
};
const STATUS:Record<string,string>={queued:"Na fila",processing:"Processando",available:"Disponível",scheduled:"Publicando",published:"Publicado",failed:"Erro",archived:"Arquivado"};

export default function InfluencerManagerPage(){
 const [profiles,setProfiles]=useState<Profile[]>([]),[selected,setSelected]=useState<Profile|null>(null),[items,setItems]=useState<Item[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const [showNew,setShowNew]=useState(false),[name,setName]=useState(""),[profileDescription,setProfileDescription]=useState(""),[instagram,setInstagram]=useState(""),[posts,setPosts]=useState("3");
 const [url,setUrl]=useState(""),[adding,setAdding]=useState(false),[publishing,setPublishing]=useState(false),[publishingItem,setPublishingItem]=useState<string|null>(null),[randomizingItem,setRandomizingItem]=useState<string|null>(null),[coverFile,setCoverFile]=useState<File|null>(null),[uploadingCover,setUploadingCover]=useState(false);
 const [coverPreviewKey,setCoverPreviewKey]=useState("");
 const [localCoverPreview,setLocalCoverPreview]=useState("");
 const [instagramConnected,setInstagramConnected]=useState(false),[instagramAccount,setInstagramAccount]=useState("");
 const [shareTargets,setShareTargets]=useState<string[]>([]);
 const [sharing,setSharing]=useState(false);
 const [shareOpen,setShareOpen]=useState(false);
 const coverPreviewUrl=selected?.cover_r2_key ? `/api/influencer/cover?profileId=${encodeURIComponent(selected.id)}&v=${encodeURIComponent(selected.cover_r2_key)}` : "";

 async function loadProfiles(){
  setLoading(true);setError("");
  try{const r=await fetch("/api/influencer/profiles",{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível carregar os perfis.");
   setProfiles(d.profiles||[]);setSelected(c=>c?(d.profiles||[]).find((p:Profile)=>p.id===c.id)||null:(d.profiles||[])[0]||null);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar.");}finally{setLoading(false);}
 }
 async function loadItems(id:string){
  try{const r=await fetch("/api/influencer/content?profileId="+encodeURIComponent(id),{cache:"no-store"}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível carregar a biblioteca.");setItems(d.items||[]);setShareTargets(Array.isArray(d.sharedWith)?d.sharedWith:[]);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar a biblioteca.");}
 }
 useEffect(()=>{void loadProfiles();},[]);
 async function loadInstagramConnection(profileId:string){
  try{const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(profileId),{cache:"no-store"}),d=await r.json().catch(()=>({}));
   setInstagramConnected(Boolean(r.ok&&d.connected));
   setInstagramAccount(typeof d.username==="string"&&d.username?`@${d.username.replace(/^@/,"")}`:"");
  }catch{setInstagramConnected(false);setInstagramAccount("");}
 }
 useEffect(()=>{
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
   body:JSON.stringify({name,description:profileDescription,instagramUsername:"",postsPerDay:Number(posts)||3,postingTimes:[],captionMode:"zh_ja_random",fixedPublishTitle:name,fixedPublishDescription:profileDescription,shareToFeed:true})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||"Não foi possível criar o perfil.");
   setProfiles(p=>[...p,d.profile]);setSelected(d.profile);setName("");setProfileDescription("");setInstagram("");setPosts("3");setShowNew(false); window.location.href="/api/influencer/instagram/oauth?profileId="+encodeURIComponent(d.profile.id);
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
   const controller=new AbortController();
   const timeout=window.setTimeout(()=>controller.abort(),45000);
   let r:Response;
   try { r=await fetch("/api/influencer/cover",{method:"POST",body:form,signal:controller.signal}); }
   catch(err) { throw new Error(err instanceof DOMException && err.name==="AbortError" ? "O envio da capa demorou mais de 45 segundos. Verifique o bucket influencer-covers no Supabase." : "Não foi possível enviar a capa."); }
   finally { window.clearTimeout(timeout); }
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error([d.error,d.code ? `Código: ${d.code}` : "",d.hint || ""].filter(Boolean).join(" "));
   setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));setCoverFile(null);setCoverPreviewKey(d.profile.cover_r2_key||"");setLocalCoverPreview("");
  }catch(e){setError(e instanceof Error?e.message:"Erro ao salvar a capa.");}finally{setUploadingCover(false);}
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
  setPublishingItem(itemId);setError("");
  try{
   const r=await fetch("/api/influencer/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"publish-item",profileId:selected.id,itemId})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||d.message||"Não foi possível publicar o Reel.");
   await loadItems(selected.id);
   await loadProfiles();
  }catch(e){setError(e instanceof Error?e.message:"Erro ao publicar o Reel.");}
  finally{setPublishingItem(null);}
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
   setShareOpen(false);setShareTargets([]);
   await loadItems(selected.id);
  }catch(e){setError(e instanceof Error?e.message:"Erro ao compartilhar a biblioteca.");}
  finally{setSharing(false);}
 }
 async function removeItem(id:string){
  const item=items.find(i=>i.id===id);if(!item)return;
  if(!window.confirm(item.status==="processing"?"Cancelar o processamento deste vídeo?":"Remover este vídeo da biblioteca?"))return;
  const r=await fetch("/api/influencer/content?id="+encodeURIComponent(id)+(item.share_id?"&shareId="+encodeURIComponent(item.share_id):""),{method:"DELETE"}),d=await r.json().catch(()=>({}));
  if(r.ok)setItems(v=>v.filter(i=>i.id!==id));else setError(d.error||"Não foi possível excluir o conteúdo.");
 }
 const available=useMemo(()=>items.filter(i=>i.status==="available").length,[items]);
 const days=selected&&selected.posts_per_day?Math.floor(available/selected.posts_per_day):0;

 return (<main className="im-page">
  <header className="im-header"><div><a className="im-back" href="/">← Clip Factory</a><span className="im-kicker">INFLUENCER MANAGER</span><h1>Influencer Manager</h1><p>Biblioteca, vídeos 9:16 e automação de publicação.</p></div><button className="im-primary" onClick={()=>setShowNew(true)}>+ Novo perfil</button></header>
  {error&&<div className="im-alert">{error}</div>}
  {showNew&&<section className="im-card im-form-card"><div className="im-card-head"><div><span className="im-kicker">NOVO PERFIL</span><h2>Criar perfil</h2></div><button className="im-ghost" onClick={()=>setShowNew(false)}>Fechar</button></div>
   <form className="im-form" onSubmit={createProfile}><label>Nome do perfil<input value={name} onChange={e=>setName(e.target.value)} placeholder="Memes BR" required /></label><label>Descrição do perfil<textarea rows={3} value={profileDescription} onChange={e=>setProfileDescription(e.target.value)} placeholder="Ex.: Memes brasileiros para publicação diária." required /></label><label>Reels por dia<select value={posts} onChange={e=>setPosts(e.target.value)}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label><label>Instagram<span className="im-field-help">A conta será conectada agora e ficará vinculada a este perfil.</span></label><button className="im-primary" disabled={saving}>{saving?"Criando e conectando…":"Criar perfil e conectar Instagram"}</button></form>
  </section>}
  <section className="im-layout">
   <aside className="im-sidebar"><div className="im-side-head"><span>SEUS PERFIS</span><strong>{profiles.length}</strong></div>{loading?<div className="im-empty">Carregando…</div>:profiles.length===0?<div className="im-empty">Crie seu primeiro perfil para começar.</div>:profiles.map(p=><button key={p.id} className={"im-profile "+(selected?.id===p.id?"active":"")} onClick={()=>setSelected(p)}><span className="im-avatar">{p.name.slice(0,1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{p.instagram_username?"@"+p.instagram_username:"Instagram não conectado"}</small></span><b>{p.posts_per_day}/dia</b></button>)}</aside>
   <section className="im-main">{!selected?<div className="im-card im-empty-main"><strong>Crie um perfil para começar.</strong><span>Depois, adicione URLs de vídeos.</span></div>:<>
    <div className="im-card im-overview"><div><span className="im-kicker">PERFIL ATIVO</span><h2>{selected.name}</h2><p>{selected.instagram_username?"@"+selected.instagram_username:"Conecte um Instagram para publicar automaticamente."}</p></div><div className="im-overview-actions"><button className="im-ghost im-danger" disabled={saving} onClick={()=>void deleteProfile()}>Excluir perfil</button></div><div className="im-stats"><div><strong>{items.length}</strong><span>vídeos</span></div><div><strong>{available}</strong><span>prontos</span></div><div><strong>{days}</strong><span>dias</span></div></div></div>

    <div className="im-card im-account"><div className="im-card-head"><div><span className="im-kicker">CONTA VINCULADA</span><h2>Instagram</h2><p>Esta conta pertence somente a este perfil e é independente do Instagram conectado na tela principal.</p></div><span className={"im-status "+(instagramConnected?"available":"archived")}>{instagramConnected?"CONECTADO":"NÃO CONECTADO"}</span></div><div className="im-account-row"><strong>{instagramAccount||"Nenhuma conta Instagram conectada"}</strong>{!instagramConnected&&<a className="im-ghost" href={"/api/influencer/instagram/oauth?profileId="+encodeURIComponent(selected.id)}>Conectar Instagram</a>}</div></div>

    <div className="im-card im-cover-card">
      <div className="im-card-head"><div><span className="im-kicker">IDENTIDADE</span><h2>Capa do perfil</h2><p>Uma única capa fixa será reutilizada nos Reels publicados por este perfil.</p></div><span className={selected.cover_r2_key?"im-cover-ok":"im-status archived"}>{selected.cover_r2_key?"CONFIGURADA":"NÃO CONFIGURADA"}</span></div>
      <div className="im-cover-upload">
        <label>Capa fixa<input key={selected.id} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>handleCoverFile(e.target.files?.[0]||null)} /></label>
        <div className="im-cover-row">{(localCoverPreview||coverPreviewUrl)?<img className="im-cover-preview" src={localCoverPreview||coverPreviewUrl} alt={`Capa de ${selected.name}`} />:null}<span>{coverFile?coverFile.name:selected.cover_r2_key?"Capa salva neste perfil":"Nenhuma capa selecionada"}</span><button type="button" className="im-primary" disabled={!coverFile||uploadingCover} onClick={()=>void uploadCover()}>{uploadingCover?"Enviando…":"Salvar capa"}</button></div>
        <small>JPG, PNG ou WEBP · máximo 5 MB. A capa é exclusiva deste perfil.</small>
      </div>
    </div>

    <div className="im-card im-identity-copy"><div className="im-card-head"><div><span className="im-kicker">IDENTIDADE DO REEL</span><h2>Identidade do Reel</h2><p>Defina o que será fixo. Se um campo ficar vazio, o sistema gera automaticamente em chinês ou japonês.</p></div><span className="im-cover-ok">{selected.fixed_publish_title&&selected.fixed_publish_description?"FIXO":"FLEXÍVEL"}</span></div><div className="im-fixed-copy"><label>Nome do Reel <span className="im-field-help">Deixe vazio para gerar automaticamente.</span><input value={selected.fixed_publish_title||""} onChange={e=>void updateProfile({fixed_publish_title:e.target.value})} placeholder="Automático" /></label><label>Descrição <span className="im-field-help">Deixe vazio para gerar automaticamente em chinês/japonês.</span><textarea rows={5} value={selected.fixed_publish_description||""} onChange={e=>void updateProfile({fixed_publish_description:e.target.value})} placeholder="Automática em chinês/japonês" /></label></div><label className="im-check"><input type="checkbox" checked={selected.share_to_feed!==false} onChange={e=>void updateProfile({share_to_feed:e.target.checked})}/><span>Publicar também na Grade Principal do Instagram</span></label></div>

    <div className="im-card im-settings"><div className="im-card-head"><div><span className="im-kicker">PUBLICAÇÃO</span><h2>Controle da publicação</h2><p>Automática: publica nos horários definidos. Manual: use “Publicar Reel” em um vídeo disponível.</p></div>
      <span className={"im-status "+(selected.publishing_enabled?"available":"archived")}>{selected.publishing_enabled?"EXECUTANDO":"PARADA"}</span></div>
      <div className="im-settings-grid"><label>Reels por dia<select value={selected.posts_per_day} onChange={e=>void updateProfile({posts_per_day:Number(e.target.value)})}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
       <label>Descrição<select value={selected.caption_mode} onChange={e=>void updateProfile({caption_mode:e.target.value})}><option value="zh_ja_random">Chinês + Japonês aleatório</option><option value="zh_random">Chinês</option><option value="ja_random">Japonês</option><option value="custom">Banco personalizado</option></select></label>
       <label className="im-check"><input type="checkbox" checked={selected.publishing_enabled} onChange={()=>void togglePublishing()}/><span>Publicação automática</span></label>
      </div>
      <div className="im-publish-controls"><button className="im-primary" disabled={publishing||selected.publishing_enabled} onClick={()=>void togglePublishing()}>{publishing?"Ativando…":"▶ Ativar publicação automática"}</button><button className="im-ghost" disabled={publishing||!selected.publishing_enabled} onClick={()=>void togglePublishing()}>■ Parar publicação</button></div>
      <div className="im-times"><span className="im-kicker">HORÁRIOS DIÁRIOS</span><div className="im-time-grid">{Array.from({length:selected.posts_per_day},(_,i)=><label key={i}>Post {i+1}<input type="time" value={selected.posting_times?.[i]||["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"][i]} onChange={e=>{const times=[...(selected.posting_times||[])];while(times.length<selected.posts_per_day)times.push("");times[i]=e.target.value;void updateProfile({posting_times:times});}} /></label>)}</div><small>A publicação automática usa estes horários. Para publicar um Reel imediatamente, use “Publicar Reel” na biblioteca.</small></div>
    </div>

    <div className="im-card im-add"><div className="im-card-head"><div><span className="im-kicker">CONTEÚDO</span><h2>Adicionar vídeo</h2><p>Cole uma URL. O vídeo será baixado uma vez, convertido para 9:16 e salvo no R2.</p></div></div>
     <form className="im-url-form" onSubmit={addUrl}><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." required /><button className="im-primary" disabled={adding}>{adding?"Processando…":"Adicionar vídeo"}</button></form>
    </div>

    <div className="im-card im-library">
      <div className="im-card-head">
        <div>
          <span className="im-kicker">BIBLIOTECA</span>
          <h2>Biblioteca de conteúdo</h2>
          <p>Conteúdo próprio e bibliotecas compartilhadas ficam separados. Só o perfil proprietário pode alterar ou excluir o vídeo original.</p>
        </div>
        <div className="im-library-head-actions">
          <span className="im-count">{items.length}</span>
          <button className="im-ghost" onClick={() => { setShareOpen(true); setShareTargets([]); }} disabled={profiles.length < 2}>Gerenciar compartilhamento</button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="im-empty">Nenhum vídeo cadastrado.</div>
      ) : (
        <>
          {items.filter(item => !item.shared).length > 0 && (
            <>
              <div className="im-library-section-title">
                <span>MEU CONTEÚDO</span>
                <small>{items.filter(item => !item.shared).length} vídeos criados por {selected.name}</small>
              </div>
              <div className="im-items">
                {items.filter(item => !item.shared).map(item => (
                  <article className="im-item" key={item.id}>
                    <div className="im-item-main">
                      <strong>{item.title || "Vídeo sem título"}</strong>
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
                          <label>Descrição para publicação<strong>{item.publish_description || "—"}</strong></label>
                        </div>
                      )}
                      {item.source_description && (
                        <div className="im-source-copy">
                          <label>Descrição original do vídeo</label>
                          <p>{item.source_description}</p>
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
                      {item.status !== "processing" && item.status !== "published" && (
                        <button className="im-ghost" onClick={() => void removeItem(item.id)}>Excluir</button>
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
  {shareOpen&&<div className="im-modal-backdrop" role="dialog" aria-modal="true"><div className="im-modal"><div className="im-card-head"><div><span className="im-kicker">BIBLIOTECA COMPARTILHADA</span><h2>Compartilhar biblioteca</h2><p>Todos os vídeos desta biblioteca serão disponibilizados nos perfis selecionados. Não é necessário escolher vídeo por vídeo.</p></div><button className="im-ghost" onClick={()=>setShareOpen(false)}>Fechar</button></div><div className="im-share-list">{profiles.filter(p=>p.id!==selected?.id).map(p=><label key={p.id} className="im-check"><input type="checkbox" checked={shareTargets.includes(p.id)} onChange={e=>setShareTargets(v=>e.target.checked?[...v,p.id]:v.filter(id=>id!==p.id))}/><span>{p.name} {p.instagram_username?("· @"+p.instagram_username.replace(/^@/,"")):""}</span></label>)}</div><div className="im-share-current"><strong>Bibliotecas atualmente compartilhadas</strong>{shareTargets.length===0?<p className="im-field-help">Nenhuma biblioteca compartilhada com outro perfil.</p>:profiles.filter(p=>shareTargets.includes(p.id)).map(p=><div key={"current-"+p.id} className="im-share-current-row"><span>{p.name}</span><button className="im-ghost" onClick={async()=>{setSharing(true);setError("");try{const r=await fetch("/api/influencer/content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"unshare-library",profileId:selected?.id,targetProfileId:p.id})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível descompartilhar a biblioteca.");await loadItems(selected!.id);}catch(e){setError(e instanceof Error?e.message:"Erro ao descompartilhar.");}finally{setSharing(false);}}}>Descompartilhar</button></div>)}</div><div className="im-modal-actions"><button className="im-primary" disabled={sharing||!shareTargets.length} onClick={()=>void shareLibrary()}>{sharing?"Compartilhando…":"Compartilhar biblioteca"}</button></div></div></div>} </main>);
}
