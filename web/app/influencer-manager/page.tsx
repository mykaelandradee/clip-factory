"use client";

import { FormEvent, useEffect, useState } from "react";

type Profile={
  id:string; name:string; instagram_username:string|null; posts_per_day:number;
  posting_times:string[]; caption_mode:string; auto_publish:boolean; repeat_when_exhausted:boolean;
  cover_r2_key?:string|null; fixed_publish_title?:string|null; fixed_publish_description?:string|null;
  share_to_feed?:boolean; publishing_enabled?:boolean; next_publish_at?:string|null;
};
type Library={
  id:string; name:string; description?:string|null; item_count:number;
  profiles:{profile_id:string;profile_name:string;priority:number;enabled:boolean}[];
};

const DEFAULT_TIMES=["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"];

export default function InfluencerManagerPage(){
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [selected,setSelected]=useState<Profile|null>(null);
  const [libraries,setLibraries]=useState<Library[]>([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [showProfiles,setShowProfiles]=useState(false),[showNew,setShowNew]=useState(false);
  const [name,setName]=useState(""),[posts,setPosts]=useState("3");
  const [librarySaving,setLibrarySaving]=useState(false),[coverFile,setCoverFile]=useState<File|null>(null),[coverPreview,setCoverPreview]=useState("");
  const [instagramConnected,setInstagramConnected]=useState(false),[instagramAccount,setInstagramAccount]=useState(""),[instagramReconnect,setInstagramReconnect]=useState(false),[instagramExpiresAt,setInstagramExpiresAt]=useState<string|null>(null);
  const [draft,setDraft]=useState({posts_per_day:3,caption_mode:"zh_ja_random",repeat_when_exhausted:false,posting_times:["09:00","11:30","14:00"],fixed_publish_title:"",fixed_publish_description:"",share_to_feed:true});

  async function loadProfiles(){
    setLoading(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles",{cache:"no-store"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível carregar os perfis.");
      const next=d.profiles||[];setProfiles(next);
      setSelected(current=>{const requested=new URLSearchParams(window.location.search).get("profileId");return (requested&&next.find((p:Profile)=>p.id===requested))||next.find((p:Profile)=>p.id===current?.id)||next[0]||null;});
    }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar os perfis.");}
    finally{setLoading(false);}
  }
  async function loadLibraries(){
    try{const r=await fetch("/api/influencer/libraries",{cache:"no-store"}),d=await r.json().catch(()=>({}));if(r.ok)setLibraries(d.libraries||[]);}catch{}
  }
  async function loadInstagram(profileId:string){
    try{
      const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(profileId),{cache:"no-store"}),d=await r.json().catch(()=>({}));
      setInstagramConnected(Boolean(r.ok&&d.connected));setInstagramReconnect(Boolean(d.requiresReconnect));
      setInstagramExpiresAt(typeof d.expiresAt==="string"?d.expiresAt:null);
      setInstagramAccount(typeof d.username==="string"&&d.username?"@"+d.username.replace(/^@/,""):"");
    }catch{setInstagramConnected(false);setInstagramReconnect(false);setInstagramExpiresAt(null);setInstagramAccount("");}
  }
  useEffect(()=>{void loadProfiles();void loadLibraries();},[]);
  useEffect(()=>{
    if(!selected)return;
    setDraft({
      posts_per_day:selected.posts_per_day||3,caption_mode:selected.caption_mode||"zh_ja_random",
      repeat_when_exhausted:Boolean(selected.repeat_when_exhausted),posting_times:[...(selected.posting_times||[])],
      fixed_publish_title:selected.fixed_publish_title||"",fixed_publish_description:selected.fixed_publish_description||"",
      share_to_feed:selected.share_to_feed!==false
    });
    setCoverFile(null);setCoverPreview("");void loadInstagram(selected.id);void loadLibraries();
  },[selected?.id,selected?.cover_r2_key]);

  async function createProfile(e:FormEvent){
    e.preventDefault();setSaving(true);setError("");
    try{
      const count=Number(posts)||3;
      const r=await fetch("/api/influencer/profiles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        name,description:"",instagramUsername:"",postsPerDay:count,postingTimes:DEFAULT_TIMES.slice(0,count),
        captionMode:"zh_ja_random",fixedPublishTitle:name,fixedPublishDescription:"",shareToFeed:true
      })});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível criar o perfil.");
      setProfiles(all=>[...all,d.profile]);setSelected(d.profile);setName("");setPosts("3");setShowNew(false);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao criar o perfil.");}finally{setSaving(false);}
  }

  async function toggleLibrary(library:Library){
    if(!selected)return;
    const linked=library.profiles.some(p=>p.profile_id===selected.id&&p.enabled);
    setLibrarySaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/libraries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:linked?"unlink":"link",libraryId:library.id,profileId:selected.id})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível alterar o vínculo.");
      await loadLibraries();
    }catch(e){setError(e instanceof Error?e.message:"Erro ao alterar o vínculo.");}finally{setLibrarySaving(false);}
  }

  async function saveProfile(){
    if(!selected)return;setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        id:selected.id,posts_per_day:draft.posts_per_day,caption_mode:draft.caption_mode,
        repeat_when_exhausted:draft.repeat_when_exhausted,posting_times:draft.posting_times.slice(0,draft.posts_per_day),
        fixed_publish_title:draft.fixed_publish_title,fixed_publish_description:draft.fixed_publish_description,share_to_feed:draft.share_to_feed
      })});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível salvar o perfil.");
      setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));
    }catch(e){setError(e instanceof Error?e.message:"Erro ao salvar o perfil.");}finally{setSaving(false);}
  }

  async function togglePublishing(){
    if(!selected)return;setSaving(true);setError("");
    try{
      const action=selected.publishing_enabled?"stop":"enable-auto";
      const r=await fetch("/api/influencer/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,profileId:selected.id})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||"Não foi possível alterar a publicação.");
      if(action==="stop")setSelected({...selected,publishing_enabled:false,next_publish_at:null});else await loadProfiles();
    }catch(e){setError(e instanceof Error?e.message:"Erro na publicação.");}finally{setSaving(false);}
  }

  async function uploadCover(){
    if(!selected||!coverFile)return;setSaving(true);setError("");
    try{
      const form=new FormData();form.append("profileId",selected.id);form.append("file",coverFile);
      const r=await fetch("/api/influencer/cover",{method:"POST",body:form});const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível salvar a capa.");
      setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));setCoverFile(null);setCoverPreview("");
    }catch(e){setError(e instanceof Error?e.message:"Erro ao salvar a capa.");}finally{setSaving(false);}
  }

  async function disconnectInstagram(){
    if(!selected||!window.confirm("Desvincular o Instagram deste perfil? A publicação automática será interrompida."))return;
    setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(selected.id),{method:"DELETE"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível desvincular o Instagram.");
      setInstagramConnected(false);setInstagramReconnect(false);setInstagramAccount("");setInstagramExpiresAt(null);
      if(d.profile){setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));}
    }catch(e){setError(e instanceof Error?e.message:"Erro ao desvincular o Instagram.");}finally{setSaving(false);}
  }

  async function deleteProfile(){
    if(!selected||!window.confirm("Excluir este perfil? Os vídeos da biblioteca não serão gerenciados por esta tela."))return;
    setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles?id="+encodeURIComponent(selected.id),{method:"DELETE"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível excluir o perfil.");
      const next=profiles.filter(p=>p.id!==selected.id);setProfiles(next);setSelected(next[0]||null);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao excluir o perfil.");}finally{setSaving(false);}
  }

  const linked=libraries.filter(l=>l.profiles.some(p=>p.profile_id===selected?.id&&p.enabled));
  const expiresSoon=Boolean(instagramExpiresAt&&new Date(instagramExpiresAt).getTime()-Date.now()<7*24*60*60*1000);
  const coverUrl=selected?.cover_r2_key?"/api/influencer/cover?profileId="+encodeURIComponent(selected.id)+"&v="+encodeURIComponent(selected.cover_r2_key):"";

  return <main className="im-page">
    <header className="im-header">
      <div className="im-header-copy">
        <a className="im-back" href="/">← Clip Factory</a>
        <span className="im-header-label">INFLUENCER MANAGER · PERFIS</span>
        <h1>Gerencie seus <em>perfis.</em></h1>
        <p>Perfil e biblioteca são áreas separadas. Aqui você configura identidade, publicação e apenas os vínculos com as bibliotecas.</p>
      </div>
      <div className="im-header-actions">
        <button className="im-ghost im-profiles-trigger" onClick={()=>setShowProfiles(true)}>SEUS PERFIS <b>{profiles.length}</b></button>
        <button className="im-primary" onClick={()=>setShowNew(true)}>+ Novo perfil</button>
      </div>
    </header>

    <nav className="im-section-tabs" aria-label="Seções do Influencer Manager">
      <a className="im-section-tab active" href="/influencer-manager"><span>01</span> PERFIS</a>
      <a className="im-section-tab" href="/influencer-manager/libraries"><span>02</span> BIBLIOTECAS</a>
    </nav>

    {error&&<div className="im-inline-error im-page-inline-error">{error}</div>}

    {showNew&&<div className="im-modal-backdrop" role="dialog" aria-modal="true">
      <div className="im-modal im-new-profile-modal">
        <div className="im-card-head"><div><span className="im-kicker">NOVO PERFIL</span><h2>Criar perfil</h2><p>Crie o perfil primeiro. A biblioteca será vinculada depois.</p></div><button className="im-ghost" type="button" onClick={()=>setShowNew(false)}>Fechar</button></div>
        <form className="im-form im-new-profile-form" onSubmit={createProfile}>
          <label>Nome do perfil<input value={name} onChange={e=>setName(e.target.value)} placeholder="Memes BR" required /></label>
          <label>Reels por dia<select className="im-form-select" value={posts} onChange={e=>setPosts(e.target.value)}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
          <div className="im-form-note">O Instagram e as bibliotecas são configurados depois.</div>
          <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowNew(false)}>Cancelar</button><button className="im-primary" disabled={saving}>{saving?"Criando…":"Criar perfil"}</button></div>
        </form>
      </div>
    </div>}

    <section className="im-layout" style={{gridTemplateColumns:"minmax(0,1fr)"}}>
      <section className="im-main">
        {!selected?<div className="im-card im-empty-main"><strong>{loading?"Carregando…":"Crie um perfil para começar."}</strong></div>:<>
          <div className="im-card im-overview">
            <div><span className="im-kicker">PERFIL ATIVO</span><h2>{selected.name}</h2><p>{selected.instagram_username?"@"+selected.instagram_username:"Conecte um Instagram para publicar automaticamente."}</p></div>
            <div className="im-overview-actions"><button className="im-ghost im-danger" disabled={saving} onClick={()=>void deleteProfile()}>Excluir perfil</button></div>
          </div>

          <div className="im-card im-account">
            <div className="im-card-head"><div><span className="im-kicker">CONTA VINCULADA</span><h2>Instagram</h2><p>Conta vinculada somente a este perfil.</p></div><span className={"im-status "+(instagramConnected?"available":"archived")}>{instagramReconnect?"RECONEXÃO NECESSÁRIA":instagramConnected?"CONECTADO":"NÃO CONECTADO"}</span></div>
            <div className="im-account-row">
              <div><strong>{instagramAccount||"Nenhuma conta Instagram conectada"}</strong>{instagramExpiresAt&&<small className="im-field-help">Token válido até {new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Cuiaba"}).format(new Date(instagramExpiresAt))}{expiresSoon?" · renovação necessária em breve":""}</small>}</div>
              {(!instagramConnected||instagramReconnect)&&<a className="im-ghost" href={"/api/influencer/instagram/oauth?profileId="+encodeURIComponent(selected.id)}>{instagramReconnect?"Reconectar Instagram":"Conectar Instagram"}</a>}
              {(instagramConnected||instagramReconnect)&&<button className="im-ghost im-danger" disabled={saving} onClick={()=>void disconnectInstagram()}>Desvincular Instagram</button>}
            </div>
          </div>

          <div className="im-card im-profile-config">
            <div className="im-card-head"><div><span className="im-kicker">CONFIGURAÇÃO DO PERFIL</span><h2>Identidade e publicação</h2><p>Essas regras pertencem ao perfil, não à biblioteca.</p></div></div>

            <div className="im-config-section">
              <div className="im-config-section-head"><div><span className="im-kicker">IDENTIDADE</span><h3>Capa do perfil</h3><p>Capa usada nos Reels publicados por este perfil.</p></div></div>
              <div className="im-cover-upload">
                <label>Arquivo da capa<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0]||null;setCoverFile(f);setCoverPreview(f?URL.createObjectURL(f):"");}} /></label>
                <div className="im-cover-row">
                  <div className="im-cover-frame">{(coverPreview||coverUrl)?<img className="im-cover-preview" src={coverPreview||coverUrl} alt={"Capa de "+selected.name}/>:<div className="im-cover-empty"><span>9:16</span><small>PRÉVIA DA CAPA</small></div>}</div>
                  <div className="im-cover-meta"><strong>{coverFile?.name||selected.cover_r2_key?"Capa configurada":"Escolha uma capa vertical"}</strong><span>A capa é uma configuração do perfil.</span><button type="button" className="im-primary" disabled={!coverFile||saving} onClick={()=>void uploadCover()}>{saving?"Enviando…":"Salvar capa"}</button></div>
                </div>
                <small>JPG, PNG ou WEBP · até 5 MB.</small>
              </div>
            </div>

            <div className="im-config-section">
              <div className="im-config-section-head"><div><span className="im-kicker">IDENTIDADE DO REEL</span><h3>Nome e descrição</h3><p>Defina o texto fixo que este perfil usará nas publicações.</p></div></div>
              <div className="im-fixed-copy">
                <label>Nome do Reel<input value={draft.fixed_publish_title} onChange={e=>setDraft(v=>({...v,fixed_publish_title:e.target.value}))} placeholder="Automático" /></label>
                <label>Descrição<textarea rows={5} value={draft.fixed_publish_description} onChange={e=>setDraft(v=>({...v,fixed_publish_description:e.target.value}))} placeholder="Automática em chinês/japonês" /></label>
              </div>
              <label className="im-check"><input type="checkbox" checked={draft.share_to_feed} onChange={e=>setDraft(v=>({...v,share_to_feed:e.target.checked}))}/><span>Publicar também na Grade Principal do Instagram</span></label>
            </div>

            <div className="im-config-section">
              <div className="im-config-section-head"><div><span className="im-kicker">PUBLICAÇÃO</span><h3>Regras e horários</h3><p>Frequência, horários e comportamento da fila deste perfil.</p></div><span className={"im-status "+(selected.publishing_enabled?"available":"archived")}>{selected.publishing_enabled?"EXECUTANDO":"PARADA"}</span></div>
              <div className="im-settings-grid">
                <label>Reels por dia<select className="im-form-select" value={draft.posts_per_day} onChange={e=>setDraft(v=>({...v,posts_per_day:Number(e.target.value)}))}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
                <label>Descrição<select className="im-form-select" value={draft.caption_mode} onChange={e=>setDraft(v=>({...v,caption_mode:e.target.value}))}><option value="zh_ja_random">Chinês + Japonês aleatório</option><option value="zh_random">Chinês</option><option value="ja_random">Japonês</option><option value="custom">Banco personalizado</option></select></label>
              </div>
              <div className="im-times"><span className="im-kicker">HORÁRIOS DIÁRIOS</span><div className="im-time-grid">{Array.from({length:draft.posts_per_day},(_,i)=><label key={i}>Post {i+1}<input type="time" value={draft.posting_times[i]||DEFAULT_TIMES[i]} onChange={e=>setDraft(v=>{const times=[...v.posting_times];while(times.length<v.posts_per_day)times.push("");times[i]=e.target.value;return {...v,posting_times:times};})}/></label>)}</div></div>
              <div className="im-publish-controls">
                <button className="im-primary" disabled={saving||selected.publishing_enabled} onClick={()=>void togglePublishing()}>▶ Ativar publicação automática</button>
                <button className="im-ghost" disabled={saving||!selected.publishing_enabled} onClick={()=>void togglePublishing()}>■ Desativar publicação</button>
                <label className="im-check im-repeat-toggle"><input type="checkbox" checked={draft.repeat_when_exhausted} onChange={e=>setDraft(v=>({...v,repeat_when_exhausted:e.target.checked}))}/><span>Repetir biblioteca quando acabar</span></label>
              </div>
              <div className="im-profile-save"><button className="im-primary" type="button" disabled={saving} onClick={()=>void saveProfile()}>{saving?"Salvando…":"Salvar alterações do perfil"}</button></div>
            </div>
          </div>

          <div className="im-card im-profile-libraries">
            <div className="im-card-head"><div><span className="im-kicker">ACESSO AO CONTEÚDO</span><h2>Bibliotecas vinculadas</h2><p>O perfil apenas escolhe quais bibliotecas poderá publicar. Para adicionar ou organizar vídeos, use a aba Bibliotecas.</p></div><a className="im-ghost" href="/influencer-manager/libraries">Abrir Bibliotecas</a></div>
            {libraries.length===0?<div className="im-empty">Nenhuma biblioteca criada. Crie uma na aba Bibliotecas.</div>:<div className="im-profile-modal-list">
              {libraries.map(l=>{const isLinked=l.profiles.some(p=>p.profile_id===selected.id&&p.enabled);return <div className="im-profile" key={l.id}>
                <span className="im-avatar">{l.name.slice(0,1).toUpperCase()}</span>
                <span><strong>{l.name}</strong><small>{l.item_count} {l.item_count===1?"vídeo":"vídeos"} · {l.profiles.filter(p=>p.enabled).length} {l.profiles.filter(p=>p.enabled).length===1?"perfil":"perfis"} vinculados</small></span>
                <button className={isLinked?"im-ghost im-danger":"im-primary"} type="button" disabled={librarySaving} onClick={()=>void toggleLibrary(l)}>{isLinked?"Desvincular":"Vincular"}</button>
              </div>})}
            </div>}
            <div className="im-form-note">Vincular uma biblioteca não move, duplica ou compartilha vídeos.</div>
          </div>
        </>}
      </section>
    </section>

    {showProfiles&&<div className="im-modal-backdrop" role="dialog" aria-modal="true">
      <div className="im-modal im-profiles-modal-card">
        <div className="im-card-head"><div><span className="im-kicker">SEUS PERFIS</span><h2>Escolha um perfil</h2><p>Selecione o perfil que você quer configurar.</p></div><button className="im-ghost" onClick={()=>setShowProfiles(false)}>Fechar</button></div>
        {profiles.length===0?<div className="im-empty">Nenhum perfil cadastrado.</div>:<div className="im-profile-modal-list">{profiles.map(p=><button key={p.id} className={"im-profile "+(selected?.id===p.id?"active":"")} onClick={()=>{setSelected(p);setShowProfiles(false)}}><span className="im-avatar">{p.name.slice(0,1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{p.instagram_username?"@"+p.instagram_username:"Instagram não conectado"}</small></span></button>)}</div>}
        <button className="im-primary im-modal-new-profile" onClick={()=>{setShowProfiles(false);setShowNew(true)}}>+ Novo perfil</button>
      </div>
    </div>}
  </main>;
}
