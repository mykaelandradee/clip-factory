"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Profile = { id:string; name:string; posting_times?:string[]; posts_per_day?:number; publishing_enabled?:boolean };
type Library = { id:string; name:string; description?:string|null; item_count:number; profiles:{profile_id:string;profile_name:string;priority:number;enabled:boolean}[] };
type Item = { id:string; source_url:string; title:string|null; status:string; created_at:string; result_url?:string|null; error_message?:string|null; library_id?:string };

const STATUS:Record<string,string>={queued:"Na fila",processing:"Processando",available:"Disponível",scheduled:"Agendado",published:"Publicado",failed:"Erro",archived:"Arquivado"};

export default function InfluencerLibrariesPage(){
  const [libraries,setLibraries]=useState<Library[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [name,setName]=useState(""),[description,setDescription]=useState("");
  const [url,setUrl]=useState(""),[videoTitle,setVideoTitle]=useState(""),[adding,setAdding]=useState(false);
  const [editing,setEditing]=useState<string|null>(null),[titleDraft,setTitleDraft]=useState("");
  const [showNewLibrary,setShowNewLibrary]=useState(false),[showLibraries,setShowLibraries]=useState(false),[showEditLibrary,setShowEditLibrary]=useState(false),[editLibraryName,setEditLibraryName]=useState(""),[editLibraryDescription,setEditLibraryDescription]=useState("");

  const selected=useMemo(()=>libraries.find(l=>l.id===selectedId)||null,[libraries,selectedId]);
  const linkedProfileId=selected?.profiles.find(p=>p.enabled)?.profile_id||"";

  async function loadLibraries(preferred?:string){
    setLoading(true);setError("");
    try{
      const r=await fetch("/api/influencer/libraries",{cache:"no-store"});const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível carregar as bibliotecas.");
      const next=d.libraries||[];setLibraries(next);
      setSelectedId(current=>preferred&&next.some((l:Library)=>l.id===preferred)?preferred:current&&next.some((l:Library)=>l.id===current)?current:next[0]?.id||"");
    }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar as bibliotecas.");}
    finally{setLoading(false);}
  }
  async function loadProfiles(){
    try{const r=await fetch("/api/influencer/profiles",{cache:"no-store"});const d=await r.json().catch(()=>({}));if(r.ok)setProfiles(d.profiles||[]);}catch{}
  }
  async function loadItems(libraryId:string){
    if(!libraryId){setItems([]);return;}
    const lib=libraries.find(l=>l.id===libraryId);
    const profileId=lib?.profiles.find(p=>p.enabled)?.profile_id||profiles[0]?.id||"";
    if(!profileId){setItems([]);return;}
    try{
      const r=await fetch("/api/influencer/content?profileId="+encodeURIComponent(profileId),{cache:"no-store"});const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível carregar o conteúdo.");
      setItems((d.items||[]).filter((item:Item)=>item.library_id===libraryId));
    }catch(e){setError(e instanceof Error?e.message:"Erro ao carregar o conteúdo.");}
  }
  useEffect(()=>{void Promise.all([loadLibraries(),loadProfiles()]);},[]);
  useEffect(()=>{if(selectedId)void loadItems(selectedId);},[selectedId,libraries,profiles]);

  async function createLibrary(e:FormEvent){
    e.preventDefault();if(!name.trim())return;setBusy(true);setError("");
    try{
      const r=await fetch("/api/influencer/libraries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",name:name.trim(),description:description.trim()})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível criar a biblioteca.");
      setName("");setDescription("");setShowNewLibrary(false);setShowLibraries(false);await loadLibraries(d.library?.id);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao criar a biblioteca.");}finally{setBusy(false);}
  }
  async function saveLibrary(e:FormEvent){
    e.preventDefault();if(!selected||!editLibraryName.trim())return;setBusy(true);setError("");
    try{
      const r=await fetch("/api/influencer/libraries",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:selected.id,name:editLibraryName.trim(),description:editLibraryDescription.trim()})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível editar a biblioteca.");
      setShowEditLibrary(false);await loadLibraries(selected.id);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao editar a biblioteca.");}finally{setBusy(false);}
  }
  async function deleteLibrary(){
    if(!selected)return;
    const count=selected.item_count||0;
    const warning=count ? "Excluir a biblioteca \"" + selected.name + "\" também excluirá " + count + " " + (count===1?"vídeo":"vídeos") + " dela. Essa ação não pode ser desfeita." : "Excluir a biblioteca \"" + selected.name + "\"? Essa ação não pode ser desfeita.";
    if(!window.confirm(warning))return;
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/influencer/libraries?id="+encodeURIComponent(selected.id),{method:"DELETE"});const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível excluir a biblioteca.");
      await loadLibraries();
    }catch(e){setError(e instanceof Error?e.message:"Erro ao excluir a biblioteca.");}finally{setBusy(false);}
  }

  async function addVideo(e:FormEvent){
    e.preventDefault();if(!selected||!linkedProfileId||!url.trim())return;setAdding(true);setError("");
    try{
      const r=await fetch("/api/influencer/content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profileId:linkedProfileId,libraryId:selected.id,sourceUrl:url.trim(),title:videoTitle.trim()})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível adicionar o vídeo.");
      setUrl("");setVideoTitle("");await loadItems(selected.id);await loadLibraries(selected.id);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao adicionar o vídeo.");}finally{setAdding(false);}
  }
  async function rename(itemId:string){
    const title=titleDraft.trim();if(!title)return;setBusy(true);setError("");
    try{
      const r=await fetch("/api/influencer/content",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:itemId,title})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível renomear o vídeo.");
      setItems(all=>all.map(i=>i.id===itemId?{...i,title}:i));setEditing(null);setTitleDraft("");
    }catch(e){setError(e instanceof Error?e.message:"Erro ao renomear o vídeo.");}finally{setBusy(false);}
  }
  async function remove(item:Item){
    if(!linkedProfileId)return;
    if(!window.confirm("Excluir este vídeo da biblioteca? O arquivo armazenado também será removido. Esta ação não pode ser desfeita."))return;
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/influencer/content?id="+encodeURIComponent(item.id)+"&profileId="+encodeURIComponent(linkedProfileId),{method:"DELETE"});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível excluir o vídeo.");
      setItems(all=>all.filter(i=>i.id!==item.id));await loadLibraries(selectedId);
    }catch(e){setError(e instanceof Error?e.message:"Erro ao excluir o vídeo.");}finally{setBusy(false);}
  }

  return <main className="im-page">
    <header className="im-header">
      <div className="im-header-copy">
        <a className="im-back" href="/influencer-manager">← Influencer Manager</a>
        <span className="im-header-label">INFLUENCER MANAGER · BIBLIOTECAS</span>
        <h1>Gerencie seu <em>conteúdo.</em></h1>
        <p>As bibliotecas são independentes dos perfis. Aqui você cria, organiza e processa os vídeos.</p>
      </div>
      <div className="im-header-actions">
        <button className="im-ghost im-profiles-trigger" type="button" onClick={()=>setShowLibraries(true)}>SUAS BIBLIOTECAS <b>{libraries.length}</b></button>
        <button className="im-primary" type="button" onClick={()=>setShowNewLibrary(true)}>+ Nova biblioteca</button>
      </div>
    </header>

    <nav className="im-section-tabs" aria-label="Seções do Influencer Manager">
      <a className="im-section-tab" href="/influencer-manager"><span>01</span> PERFIS</a>
      <a className="im-section-tab active" href="/influencer-manager/libraries"><span>02</span> BIBLIOTECAS</a>
    </nav>

    {error&&<div className="im-inline-error im-page-inline-error">{error}</div>}

    {showLibraries&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="suas-bibliotecas-title">
      <div className="im-modal im-profiles-modal-card">
        <div className="im-card-head"><div><span className="im-kicker">SUAS BIBLIOTECAS</span><h2 id="suas-bibliotecas-title">Escolha uma biblioteca</h2><p>Selecione a biblioteca que você quer gerenciar.</p></div><button className="im-ghost" type="button" onClick={()=>setShowLibraries(false)}>Fechar</button></div>
        {libraries.length===0?<div className="im-empty">Nenhuma biblioteca cadastrada.</div>:<div className="im-profile-modal-list">
          {libraries.map(l=><button key={l.id} type="button" className={"im-profile "+(selectedId===l.id?"active":"")} onClick={()=>{setSelectedId(l.id);setShowLibraries(false)}}>
            <span className="im-avatar">{l.name.slice(0,1).toUpperCase()}</span>
            <span><strong>{l.name}</strong><small>{l.item_count} {l.item_count===1?"vídeo":"vídeos"} · {l.profiles.filter(p=>p.enabled).length} {l.profiles.filter(p=>p.enabled).length===1?"perfil":"perfis"} vinculados</small></span>
          </button>)}
        </div>}
        <button className="im-primary im-modal-new-profile" type="button" onClick={()=>{setShowLibraries(false);setShowNewLibrary(true)}}>+ Nova biblioteca</button>
      </div>
    </div>}

    {showNewLibrary&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="nova-biblioteca-title">
      <div className="im-modal im-new-profile-modal">
        <div className="im-card-head">
          <div><span className="im-kicker">NOVA BIBLIOTECA</span><h2 id="nova-biblioteca-title">Criar biblioteca</h2><p>Crie uma biblioteca independente dos perfis. Depois, vincule-a aos perfis que poderão publicá-la.</p></div>
          <button className="im-ghost" type="button" onClick={()=>setShowNewLibrary(false)}>Fechar</button>
        </div>
        <form className="im-form im-new-profile-form" onSubmit={createLibrary}>
          <label>Nome da biblioteca<input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex.: Futebol, Memes, Patolino" maxLength={80} required autoFocus /></label>
          <label>Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Opcional" maxLength={500} /></label>
          <div className="im-form-note">A biblioteca não pertence a um perfil. O vínculo com perfis é configurado separadamente.</div>
          <div className="im-modal-actions">
            <button className="im-ghost" type="button" onClick={()=>setShowNewLibrary(false)}>Cancelar</button>
            <button className="im-primary" disabled={busy}>{busy?"Criando…":"Criar biblioteca"}</button>
          </div>
        </form>
      </div>
    </div>}

    <section className="im-layout" style={{gridTemplateColumns:"minmax(0,1fr)"}}>
      <section className="im-main">
        <div className="im-card im-overview">
          <div>
            <span className="im-kicker">BIBLIOTECA ATIVA</span>
            <h2>{selected?.name||"Selecione uma biblioteca"}</h2>
            <p>{selected?.description||"Selecione uma biblioteca para gerenciar seus vídeos."}</p>
          </div>
          <div className="im-stats">
            <div><strong>{selected?.item_count||0}</strong><span>VÍDEOS</span></div>
            <div><strong>{selected?.profiles.filter(p=>p.enabled).length||0}</strong><span>PERFIS VINCULADOS</span></div>
          </div>
        </div>

        {selected&&<div className="im-card im-content-add">
          <div className="im-card-head"><div><span className="im-kicker">CONTEÚDO</span><h2>Adicionar vídeo</h2><p>O vídeo será salvo diretamente em <strong>{selected.name}</strong>.</p></div></div>
          {!linkedProfileId?<div className="im-empty"><strong>Vincule um perfil a esta biblioteca primeiro.</strong><span>O perfil é usado apenas para preparar o processamento; o conteúdo continua pertencendo à biblioteca.</span><a className="im-ghost" href="/influencer-manager">Ir para Perfis</a></div>:
          <form className="im-url-form" onSubmit={addVideo}>
            <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://youtube.com/... ou https://instagram.com/reel/..." required />
            <input value={videoTitle} onChange={e=>setVideoTitle(e.target.value)} placeholder="Título do vídeo (opcional)" maxLength={500} />
            <button className="im-primary" disabled={adding}>{adding?"Processando…":"Adicionar vídeo"}</button>
          </form>}
        </div>}

        {selected&&<div className="im-card im-library-content">
          <div className="im-card-head"><div><span className="im-kicker">CONTEÚDO</span><h2>Vídeos da biblioteca</h2><p>Gerencie títulos, processamento e arquivos desta biblioteca. A publicação é controlada pelo perfil.</p></div><span className="im-count">{items.length}</span></div>
          {items.length===0?<div className="im-empty">Nenhum vídeo nesta biblioteca.</div>:<div className="im-items">
            {items.map(item=><article className={"im-item "+(item.status==="available"?"im-item-ready":"")} key={item.id}>
              <div className="im-item-main">
                <strong>{item.title||"Vídeo sem título"}</strong>
                <span>{item.source_url}</span>
                {item.status==="processing"&&<div className="im-progress"><div><span style={{width:"35%"}}/></div><small>Processando vídeo…</small></div>}
                {item.error_message&&<small className="im-error-text">{item.error_message}</small>}
                {item.result_url&&<video className="im-video-preview" src={item.result_url} controls preload="metadata" />}
              </div>
              <div className="im-item-actions">
                <span className={"im-status "+item.status}>{STATUS[item.status]||item.status}</span>
                {item.result_url&&<a className="im-ghost" href={item.result_url} target="_blank" rel="noreferrer">Abrir vídeo</a>}
                {editing===item.id?<><input className="im-form-select" value={titleDraft} onChange={e=>setTitleDraft(e.target.value)} /><button className="im-primary" disabled={busy} onClick={()=>void rename(item.id)}>Salvar</button><button className="im-ghost" onClick={()=>setEditing(null)}>Cancelar</button></>:<button className="im-ghost" onClick={()=>{setEditing(item.id);setTitleDraft(item.title||"")}}>Renomear</button>}
                <button className="im-ghost im-delete-item" disabled={busy} onClick={()=>void remove(item)}>Excluir vídeo</button>
              </div>
            </article>)}
          </div>}
        </div>}
      </section>
    </section>
  </main>;
}
