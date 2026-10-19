"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "./platform.css";

type Profile={
  id:string; name:string; instagram_username:string|null; posts_per_day:number;
  posting_times:string[]; caption_mode:string; auto_publish:boolean; repeat_when_exhausted:boolean;
  cover_r2_key?:string|null; fixed_publish_title?:string|null; fixed_publish_description?:string|null;
  share_to_feed?:boolean; auto_story?:boolean; story_delay_minutes?:number; publishing_enabled?:boolean; next_publish_at?:string|null;
  platform?:"instagram"|"youtube"; youtube_channel_title?:string|null;
  last_publish_status?:"published"|"empty"|"error"|"retry"|null; last_publish_message?:string|null; last_publish_at?:string|null;
};
type Platform="instagram"|"youtube";
const PLATFORM_LABEL:Record<Platform,string>={instagram:"Instagram",youtube:"YouTube"};
const platformOf=(p?:Profile|null):Platform=>p?.platform==="youtube"?"youtube":"instagram";
type Library={
  id:string; name:string; description?:string|null; item_count:number;
  profiles:{profile_id:string;profile_name:string;priority:number;enabled:boolean}[];
};
type Item={
  id:string; source_url:string; title:string|null; status:string; created_at:string;
  published_at?:string|null; result_url?:string|null; error_message?:string|null;
};
type AnalyticsMetric={id:string;item_id:string;instagram_media_id:string;title:string;category:string;fetched_at:string;views:number|null;reach:number|null;likes:number|null;comments:number|null;shares:number|null;saves:number|null;follows:number|null;profile_visits:number|null};
type PublishedReel={id:string;item_id:string;instagram_media_id?:string|null;youtube_video_id?:string|null;title:string;category:string;published_at:string|null;hasMetrics:boolean;fetched_at:string|null;views:number|null;reach:number|null;likes:number|null;comments:number|null;shares:number|null;saves:number|null;follows:number|null};
type YouTubeState={connected:boolean;requiresReconnect:boolean;channelTitle:string;channelHandle:string;lastError:string};
const EMPTY_YOUTUBE:YouTubeState={connected:false,requiresReconnect:false,channelTitle:"",channelHandle:"",lastError:""};
const YOUTUBE_ERRORS:Record<string,string>={
  canceled:"A autorização do YouTube foi cancelada.",
  invalid_callback:"A autorização do YouTube expirou. Tente conectar de novo.",
  not_configured:"A integração do YouTube não está configurada no servidor.",
  invalid_profile:"Perfil não encontrado para vincular o YouTube.",
  missing_profile:"Escolha um perfil antes de conectar o YouTube.",
  token_exchange:"O Google não devolveu uma autorização válida. Tente conectar de novo.",
  channel_in_use:"Este canal do YouTube já está vinculado a outro perfil. Desvincule-o lá primeiro.",
  no_channel:"A conta Google escolhida não tem um canal do YouTube. Escolha a conta ou o canal de marca correto.",
  save_failed:"Não foi possível salvar o canal do YouTube. Tente de novo.",
  wrong_platform:"Este é um perfil do Instagram. Crie um perfil do YouTube para conectar um canal.",
};
const INSTAGRAM_ERRORS:Record<string,string>={
  wrong_platform:"Este é um perfil do YouTube. Crie um perfil do Instagram para conectar uma conta.",
};
type AnalyticsData={totals:any;categoryTotals:any[];metrics:AnalyticsMetric[];publishedReels:PublishedReel[];metricCoverage:{follows:number;reach:number;views:number};publishedSummary:{total:number;withInstagramId:number;withMetrics:number}};

const formatDateTime=(value:string)=>new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Cuiaba"}).format(new Date(value));
const PUBLISH_STATUS_LABEL:Record<string,string>={published:"Última publicação concluída",empty:"Fila vazia",error:"Publicação falhou",retry:"Nova tentativa agendada"};

const DEFAULT_TIMES=["09:00","11:30","14:00","16:30","19:00","21:30","23:00","08:00","12:00"];
const TIME_PATTERN=/^([01]\d|2[0-3]):[0-5]\d$/;
// Os campos de horário exibem os padrões quando o perfil não tem horário salvo.
// Esta função devolve exatamente o que está na tela, para a prévia e o salvamento.
const effectiveTimes=(times:string[]|null|undefined,postsPerDay:number)=>
  Array.from({length:Math.max(1,Math.min(9,postsPerDay||1))},(_,i)=>{const value=(times||[])[i];return value&&TIME_PATTERN.test(value)?value:DEFAULT_TIMES[i];});

export default function InfluencerManagerPage(){
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [selected,setSelected]=useState<Profile|null>(null);
  const [items,setItems]=useState<Item[]>([]);
  const [libraries,setLibraries]=useState<Library[]>([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [showFeedback,setShowFeedback]=useState(false),[feedbackTitle,setFeedbackTitle]=useState("Algo deu errado"),[feedbackMessage,setFeedbackMessage]=useState("");
  const [showDisconnectConfirm,setShowDisconnectConfirm]=useState(false);
  const [showProfiles,setShowProfiles]=useState(false),[showNew,setShowNew]=useState(false),[showEditProfile,setShowEditProfile]=useState(false),[showDeleteProfile,setShowDeleteProfile]=useState(false);
  const [name,setName]=useState(""),[posts,setPosts]=useState("3"),[editProfileName,setEditProfileName]=useState(""),[newPlatform,setNewPlatform]=useState<Platform>("instagram");
  const [librarySaving,setLibrarySaving]=useState(false),[coverFile,setCoverFile]=useState<File|null>(null),[coverPreview,setCoverPreview]=useState("");
  const [instagramConnected,setInstagramConnected]=useState(false),[instagramAccount,setInstagramAccount]=useState(""),[instagramReconnect,setInstagramReconnect]=useState(false),[instagramExpiresAt,setInstagramExpiresAt]=useState<string|null>(null);
  const [youtube,setYoutube]=useState<YouTubeState>(EMPTY_YOUTUBE),[showYouTubeDisconnect,setShowYouTubeDisconnect]=useState(false),[publishingNow,setPublishingNow]=useState(false);
  const [draft,setDraft]=useState({posts_per_day:3,caption_mode:"zh_ja_random",repeat_when_exhausted:false,posting_times:["09:00","11:30","14:00"],fixed_publish_title:"",fixed_publish_description:"",share_to_feed:true,auto_story:false,story_delay_minutes:30});
  const [analytics,setAnalytics]=useState<AnalyticsData>({totals:{},categoryTotals:[],metrics:[],publishedReels:[],metricCoverage:{follows:0,reach:0,views:0},publishedSummary:{total:0,withInstagramId:0,withMetrics:0}});
  const [analyticsLoading,setAnalyticsLoading]=useState(false);
  const analyticsRequestRef=useRef(0);
  const [analyticsMessage,setAnalyticsMessage]=useState("");

  function showError(message:string,title="Não foi possível concluir a ação"){
    setError(message);setFeedbackTitle(title);setFeedbackMessage(message);setShowFeedback(true);
  }

  async function loadProfiles(){
    setLoading(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles",{cache:"no-store"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível carregar os perfis.");
      const next=d.profiles||[];setProfiles(next);
      setSelected(current=>{const requested=new URLSearchParams(window.location.search).get("profileId");return (requested&&next.find((p:Profile)=>p.id===requested))||next.find((p:Profile)=>p.id===current?.id)||next[0]||null;});
    }catch(e){showError(e instanceof Error?e.message:"Erro ao carregar os perfis.","Não foi possível carregar os perfis");}
    finally{setLoading(false);}
  }
  async function loadLibraries(){
    try{const r=await fetch("/api/influencer/libraries",{cache:"no-store"}),d=await r.json().catch(()=>({}));if(r.ok)setLibraries(d.libraries||[]);}catch{}
  }
  async function loadItems(profileId:string){
    try{
      const r=await fetch("/api/influencer/content?profileId="+encodeURIComponent(profileId),{cache:"no-store"}),d=await r.json().catch(()=>({}));
      if(r.ok)setItems(d.items||[]);
    }catch{}
  }
  async function loadYouTube(profileId:string){
    try{
      const r=await fetch("/api/influencer/youtube/status?profileId="+encodeURIComponent(profileId),{cache:"no-store"}),d=await r.json().catch(()=>({}));
      if(!r.ok){setYoutube(EMPTY_YOUTUBE);return;}
      setYoutube({
        connected:Boolean(d.connected),requiresReconnect:Boolean(d.requiresReconnect),
        channelTitle:typeof d.channelTitle==="string"?d.channelTitle:"",channelHandle:typeof d.channelHandle==="string"?d.channelHandle:"",
        lastError:typeof d.lastError==="string"?d.lastError:"",
      });
    }catch{setYoutube(EMPTY_YOUTUBE);}
  }
  async function disconnectYouTube(){
    if(!selected)return;
    setShowYouTubeDisconnect(false);setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/youtube/status?profileId="+encodeURIComponent(selected.id),{method:"DELETE"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível desvincular o YouTube.");
      if(d.profile){setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));}
      await loadYouTube(selected.id);
    }catch(e){showError(e instanceof Error?e.message:"Erro ao desvincular o YouTube.","Não foi possível desvincular o YouTube");}finally{setSaving(false);}
  }
  async function loadInstagram(profileId:string){
    try{
      const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(profileId),{cache:"no-store"}),d=await r.json().catch(()=>({}));
      setInstagramConnected(Boolean(r.ok&&d.connected));setInstagramReconnect(Boolean(d.requiresReconnect));
      setInstagramExpiresAt(typeof d.expiresAt==="string"?d.expiresAt:null);
      setInstagramAccount(typeof d.username==="string"&&d.username?"@"+d.username.replace(/^@/,""):"");
    }catch{setInstagramConnected(false);setInstagramReconnect(false);setInstagramExpiresAt(null);setInstagramAccount("");}
  }
  async function loadAnalytics(profileId:string,sync=false){
    const requestId=++analyticsRequestRef.current;
    setAnalyticsLoading(true);setAnalyticsMessage("");
    try{
      const endpoint=platformOf(selected)==="youtube"?"/api/influencer/youtube/analytics":"/api/influencer/analytics";
      const r=await fetch(endpoint+"?profileId="+encodeURIComponent(profileId)+(sync?"&sync=true":""),{cache:"no-store"});
      const d=await r.json().catch(()=>({}));
      if(requestId!==analyticsRequestRef.current)return;
      if(!r.ok)throw new Error(d.error||"Não foi possível carregar as métricas.");
      setAnalytics({totals:d.totals||{},categoryTotals:d.categoryTotals||[],metrics:d.metrics||[],publishedReels:d.publishedReels||[],metricCoverage:d.metricCoverage||{follows:0,reach:0,views:0},publishedSummary:d.publishedSummary||{total:0,withInstagramId:0,withMetrics:0}});
      const diagnostics=Array.isArray(d.diagnostics)?d.diagnostics.filter((value:any)=>typeof value==="string"&&value.trim()):[];
      if(diagnostics.length)setAnalyticsMessage(diagnostics.join(" · "));
      else if(d.message)setAnalyticsMessage(String(d.message));
    }catch(e){if(requestId===analyticsRequestRef.current)setAnalyticsMessage(e instanceof Error?e.message:"Não foi possível carregar as métricas.");}
    finally{if(requestId===analyticsRequestRef.current)setAnalyticsLoading(false);}
  }
  useEffect(()=>{void loadProfiles();void loadLibraries();},[]);
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const youtubeError=params.get("youtube_profile_error");
    const instagramError=params.get("instagram_profile_error");
    if(youtubeError)showError(YOUTUBE_ERRORS[youtubeError]||"Não foi possível conectar o YouTube.","Não foi possível conectar o YouTube");
    else if(instagramError)showError(INSTAGRAM_ERRORS[instagramError]||"Não foi possível conectar o Instagram. Tente de novo.","Não foi possível conectar o Instagram");
    if(youtubeError||instagramError||params.has("youtube_profile_connected")||params.has("instagram_profile_connected")){
      params.delete("youtube_profile_error");params.delete("youtube_profile_connected");
      params.delete("instagram_profile_error");params.delete("instagram_profile_connected");
      const query=params.toString();
      window.history.replaceState(null,"",window.location.pathname+(query?"?"+query:""));
    }
  },[]);
  // Mantém a agenda sincronizada durante o processamento e a publicação automática.
  const processingItemsKey=items.filter(item=>item.status==="processing").map(item=>item.id).join(",");
  useEffect(()=>{
    if(!selected?.id||(!selected.publishing_enabled&&!processingItemsKey))return;
    let active=true;
    const timer=setInterval(()=>{
      if(active)void loadItems(selected.id);
    },15000);
    return ()=>{active=false;clearInterval(timer);};
  },[selected?.id,selected?.publishing_enabled,processingItemsKey]);

  useEffect(()=>{
    if(!selected)return;
    // Limpa imediatamente os dados do perfil anterior e invalida respostas atrasadas.
    analyticsRequestRef.current++;
    setAnalytics({totals:{},categoryTotals:[],metrics:[],publishedReels:[],metricCoverage:{follows:0,reach:0,views:0},publishedSummary:{total:0,withInstagramId:0,withMetrics:0}});
    setAnalyticsMessage("");
    setAnalyticsLoading(false);
    setDraft({
      posts_per_day:selected.posts_per_day||3,caption_mode:selected.caption_mode||"zh_ja_random",
      repeat_when_exhausted:Boolean(selected.repeat_when_exhausted),posting_times:effectiveTimes(selected.posting_times,selected.posts_per_day||3),
      fixed_publish_title:selected.fixed_publish_title||"",fixed_publish_description:selected.fixed_publish_description||"",
      share_to_feed:selected.share_to_feed!==false,auto_story:Boolean(selected.auto_story),story_delay_minutes:Number(selected.story_delay_minutes)||30
    });
    setCoverFile(null);setCoverPreview("");
    setInstagramConnected(false);setInstagramReconnect(false);setInstagramAccount("");setInstagramExpiresAt(null);setYoutube(EMPTY_YOUTUBE);
    if(platformOf(selected)==="youtube")void loadYouTube(selected.id);
    else void loadInstagram(selected.id);
    void loadAnalytics(selected.id);
    void loadLibraries();void loadItems(selected.id);
  },[selected?.id,selected?.cover_r2_key]);

  async function createProfile(e:FormEvent){
    e.preventDefault();setSaving(true);setError("");
    try{
      const count=Number(posts)||3;
      const r=await fetch("/api/influencer/profiles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        name,platform:newPlatform,description:"",instagramUsername:"",postsPerDay:count,postingTimes:DEFAULT_TIMES.slice(0,count),
        captionMode:"zh_ja_random",fixedPublishTitle:name,fixedPublishDescription:"",shareToFeed:true,autoStory:false,storyDelayMinutes:30
      })});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível criar o perfil.");
      setProfiles(all=>[...all,d.profile]);setSelected(d.profile);setName("");setPosts("3");setNewPlatform("instagram");setShowNew(false);
    }catch(e){showError(e instanceof Error?e.message:"Erro ao criar o perfil.","Não foi possível criar o perfil");}finally{setSaving(false);}
  }

  async function toggleLibrary(library:Library){
    if(!selected)return;
    const linked=library.profiles.some(p=>p.profile_id===selected.id&&p.enabled);
    setLibrarySaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/libraries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:linked?"unlink":"link",libraryId:library.id,profileId:selected.id})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível alterar o vínculo.");
      await loadLibraries();
    }catch(e){showError(e instanceof Error?e.message:"Erro ao alterar o vínculo.","Não foi possível alterar a biblioteca");}finally{setLibrarySaving(false);}
  }

  async function saveProfileName(e:FormEvent){
    e.preventDefault();if(!selected||!editProfileName.trim())return;setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:selected.id,name:editProfileName.trim()})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível renomear o perfil.");
      setSelected(d.profile);setProfiles(all=>all.map(item=>item.id===d.profile.id?d.profile:item));setShowEditProfile(false);
    }catch(e){showError(e instanceof Error?e.message:"Erro ao renomear o perfil.","Não foi possível renomear o perfil");}finally{setSaving(false);}
  }

  async function saveProfile(){
    if(!selected)return;setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        id:selected.id,posts_per_day:draft.posts_per_day,caption_mode:draft.caption_mode,
        repeat_when_exhausted:draft.repeat_when_exhausted,posting_times:effectiveTimes(draft.posting_times,draft.posts_per_day),
        fixed_publish_title:draft.fixed_publish_title,fixed_publish_description:draft.fixed_publish_description,share_to_feed:draft.share_to_feed,auto_story:draft.auto_story,story_delay_minutes:draft.story_delay_minutes
      })});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível salvar o perfil.");
      setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));
    }catch(e){showError(e instanceof Error?e.message:"Erro ao salvar o perfil.","Não foi possível salvar as configurações");}finally{setSaving(false);}
  }

  async function togglePublishing(){
    if(!selected)return;setSaving(true);setError("");
    try{
      const action=selected.publishing_enabled?"stop":"enable-auto";
      const r=await fetch("/api/influencer/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,profileId:selected.id})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||d.message||"Não foi possível alterar a publicação.");
      if(action==="stop")setSelected({...selected,publishing_enabled:false,next_publish_at:null});else await loadProfiles();
    }catch(e){showError(e instanceof Error?e.message:"Erro na publicação.","Não foi possível alterar a publicação automática");}finally{setSaving(false);}
  }

  async function publishNextNow(){
    if(!selected)return;setPublishingNow(true);setError("");
    try{
      const r=await fetch("/api/influencer/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"publish-next",profileId:selected.id})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível publicar agora. Tente novamente em alguns instantes.");
      await loadProfiles();await loadItems(selected.id);
      if(platformOf(selected)==="youtube")await loadYouTube(selected.id);
    }catch(e){showError(e instanceof Error?e.message:"Erro ao publicar.","Não foi possível publicar agora");await loadProfiles();}
    finally{setPublishingNow(false);}
  }

  async function retryAllFailed(){
    if(!selected)return;setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/content",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({profileId:selected.id,retryFailed:true})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Não foi possível devolver os vídeos à fila.");
      await loadItems(selected.id);
    }catch(e){showError(e instanceof Error?e.message:"Erro ao tentar de novo.","Não foi possível tentar de novo");}finally{setSaving(false);}
  }

  async function uploadCover(){
    if(!selected||!coverFile)return;setSaving(true);setError("");
    try{
      const form=new FormData();form.append("profileId",selected.id);form.append("file",coverFile);
      const r=await fetch("/api/influencer/cover",{method:"POST",body:form});const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível salvar a capa.");
      setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));setCoverFile(null);setCoverPreview("");
    }catch(e){showError(e instanceof Error?e.message:"Erro ao salvar a capa.","Não foi possível salvar a capa");}finally{setSaving(false);}
  }

  async function disconnectInstagram(){
    if(!selected)return;
    setShowDisconnectConfirm(false);setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/instagram/status?profileId="+encodeURIComponent(selected.id),{method:"DELETE"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível desvincular o Instagram.");
      setInstagramConnected(false);setInstagramReconnect(false);setInstagramAccount("");setInstagramExpiresAt(null);
      if(d.profile){setSelected(d.profile);setProfiles(all=>all.map(p=>p.id===d.profile.id?d.profile:p));}
    }catch(e){showError(e instanceof Error?e.message:"Erro ao desvincular o Instagram.","Não foi possível desvincular o Instagram");}finally{setSaving(false);}
  }

  async function deleteProfile(){
    if(!selected)return;
    setShowDeleteProfile(true);
  }
  async function confirmDeleteProfile(){
    if(!selected)return;
    setShowDeleteProfile(false);setSaving(true);setError("");
    try{
      const r=await fetch("/api/influencer/profiles?id="+encodeURIComponent(selected.id),{method:"DELETE"}),d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Não foi possível excluir o perfil.");
      const next=profiles.filter(p=>p.id!==selected.id);setProfiles(next);setSelected(next[0]||null);
    }catch(e){showError(e instanceof Error?e.message:"Erro ao excluir o perfil.","Não foi possível excluir o perfil");}finally{setSaving(false);}
  }

  const platform=platformOf(selected);
  const isYouTube=platform==="youtube";
  const accountConnected=isYouTube?youtube.connected:instagramConnected;
  const videoUnit=isYouTube?"Shorts":"Reels";
  const linked=libraries.filter(l=>l.profiles.some(p=>p.profile_id===selected?.id&&p.enabled));
  const expiresSoon=Boolean(instagramExpiresAt&&new Date(instagramExpiresAt).getTime()-Date.now()<7*24*60*60*1000);
  const coverUrl=selected?.cover_r2_key?"/api/influencer/cover?profileId="+encodeURIComponent(selected.id)+"&v="+encodeURIComponent(selected.cover_r2_key):"";
  const published=useMemo(()=>items.filter(i=>i.status==="published").length,[items]);
  const failedItems=useMemo(()=>items.filter(i=>i.status==="failed"),[items]);
  const queuePreview=useMemo(()=>{
    if(!selected||!selected.publishing_enabled)return [];
    const times=[...new Set(effectiveTimes(draft.posting_times,draft.posts_per_day))].sort();
    if(!times.length)return [];
    const available=items.filter(i=>i.status==="available")
      .sort((a,b)=>String(a.created_at||"").localeCompare(String(b.created_at||"")));
    // A fila real publica primeiro os disponíveis e, quando acabam, reutiliza os
    // já publicados (do mais antigo para o mais recente) se a repetição estiver ativa.
    const publishedForRepeat=draft.repeat_when_exhausted
      ? items.filter(i=>i.status==="published")
          .sort((a,b)=>String(a.published_at||a.created_at||"").localeCompare(String(b.published_at||b.created_at||"")))
      : [];
    const cycle=[...available,...publishedForRepeat];
    if(!cycle.length)return [];
    // Com repetição a fila não acaba: mostra os próximos 6 horários em ciclo.
    const limit=draft.repeat_when_exhausted?6:Math.min(6,available.length);
    const anchor=selected.next_publish_at?new Date(selected.next_publish_at):new Date();
    const out:{at:Date;item:Item}[]=[];
    for(let day=0;day<14&&out.length<limit;day++){
      for(const time of times){
        if(out.length>=limit)break;
        const [h,m]=time.split(":").map(Number);
        const at=new Date(anchor);
        at.setDate(at.getDate()+day); at.setHours(h,m,0,0);
        if(at.getTime()<anchor.getTime())continue;
        out.push({at,item:cycle[out.length%cycle.length]});
      }
    }
    return out;
  },[items,selected?.id,selected?.publishing_enabled,selected?.next_publish_at,draft.posting_times,draft.posts_per_day,draft.repeat_when_exhausted]);

  return <main className="im-page">
    <header className="im-header">
      <div className="im-header-copy">
        <a className="im-back" href="/">← Clip Factory</a>
        <span className="im-header-label">INFLUENCER MANAGER · PERFIS</span>
        <h1>Gerencie seus <em>perfis.</em></h1>
        <p>Configure a identidade, a publicação e as bibliotecas vinculadas deste perfil.</p>
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

    

    {showNew&&<div className="im-modal-backdrop" role="dialog" aria-modal="true">
      <div className="im-modal im-new-profile-modal">
        <div className="im-card-head"><div><span className="im-kicker">NOVO PERFIL</span><h2>Criar perfil</h2><p>Cada perfil publica em uma rede. A conta e as bibliotecas são configuradas depois.</p></div><button className="im-ghost" type="button" onClick={()=>setShowNew(false)}>Fechar</button></div>
        <form className="im-form im-new-profile-form" onSubmit={createProfile}>
          <fieldset className="im-platform-choice">
            <legend>Rede social</legend>
            {(["instagram","youtube"] as Platform[]).map(option=><label key={option} className={"im-platform-option"+(newPlatform===option?" active":"")}>
              <input type="radio" name="platform" value={option} checked={newPlatform===option} onChange={()=>setNewPlatform(option)} />
              <strong>{PLATFORM_LABEL[option]}</strong>
              <small>{option==="youtube"?"Publica Shorts em um canal do YouTube.":"Publica Reels e Stories numa conta do Instagram."}</small>
            </label>)}
          </fieldset>
          <label>Nome do perfil<input value={name} onChange={e=>setName(e.target.value)} placeholder="Memes BR" required /></label>
          <label>{newPlatform==="youtube"?"Shorts":"Reels"} por dia<select className="im-form-select" value={posts} onChange={e=>setPosts(e.target.value)}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
          <div className="im-form-note">A rede não pode ser trocada depois. Para publicar nas duas, crie um perfil para cada uma.</div>
          <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowNew(false)}>Cancelar</button><button className="im-primary" disabled={saving}>{saving?"Criando…":"Criar perfil"}</button></div>
        </form>
      </div>
    </div>}

    <section className="im-layout" style={{gridTemplateColumns:"minmax(0,1fr)"}}>
      <section className="im-main">
        {!selected?<div className="im-card im-empty-main"><strong>{loading?"Carregando…":"Crie um perfil para começar."}</strong></div>:<>
          <div className="im-card im-overview">
            <div><span className="im-kicker">PERFIL ATIVO · {PLATFORM_LABEL[platform].toUpperCase()}</span><h2>{selected.name}</h2><p>{isYouTube?(selected.youtube_channel_title||"Conecte um canal do YouTube para publicar automaticamente."):(selected.instagram_username?"@"+selected.instagram_username:"Conecte um Instagram para publicar automaticamente.")}</p></div>
            <div className="im-overview-actions"><button className="im-ghost" disabled={saving} onClick={()=>{setEditProfileName(selected.name);setShowEditProfile(true)}}>Editar perfil</button><button className="im-ghost im-danger" disabled={saving} onClick={()=>void deleteProfile()}>Excluir perfil</button></div>
          </div>



          {!isYouTube&&<div className="im-card im-account">
            <div className="im-card-head"><div><span className="im-kicker">CONTA VINCULADA</span><h2>Instagram</h2><p>Conta vinculada somente a este perfil.</p></div><span className={"im-status "+(instagramConnected?"available":"archived")}>{instagramReconnect?"RECONEXÃO NECESSÁRIA":instagramConnected?"CONECTADO":"NÃO CONECTADO"}</span></div>
            <div className="im-account-row">
              <div><strong>{instagramAccount||"Nenhuma conta Instagram conectada"}</strong>{instagramExpiresAt&&<small className="im-field-help">Token válido até {new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Cuiaba"}).format(new Date(instagramExpiresAt))}{expiresSoon?" · renovação necessária em breve":""}</small>}</div>
              {(!instagramConnected||instagramReconnect)&&<a className="im-ghost" href={"/api/influencer/instagram/oauth?profileId="+encodeURIComponent(selected.id)}>{instagramReconnect?"Reconectar Instagram":"Conectar Instagram"}</a>}
              {(instagramConnected||instagramReconnect)&&<button className="im-ghost im-danger" disabled={saving} onClick={()=>void disconnectInstagram()}>Desvincular Instagram</button>}
            </div>
          </div>}

          {isYouTube&&<div className="im-card im-account">
            <div className="im-card-head"><div><span className="im-kicker">CANAL VINCULADO</span><h2>YouTube</h2><p>Canal vinculado somente a este perfil. Os vídeos são publicados como Shorts.</p></div><span className={"im-status "+(youtube.connected?"available":"archived")}>{youtube.requiresReconnect?"RECONEXÃO NECESSÁRIA":youtube.connected?"CONECTADO":"NÃO CONECTADO"}</span></div>
            <div className="im-account-row">
              <div>
                <strong>{youtube.channelTitle||"Nenhum canal do YouTube conectado"}</strong>
                <small className="im-field-help">{youtube.channelHandle||(youtube.connected?"":"Na autorização, escolha a conta ou o canal de marca deste perfil.")}{youtube.requiresReconnect&&youtube.lastError?" · "+youtube.lastError:""}</small>
              </div>
              {(!youtube.connected||youtube.requiresReconnect)&&<a className="im-ghost" href={"/api/influencer/youtube/oauth?profileId="+encodeURIComponent(selected.id)}>{youtube.requiresReconnect?"Reconectar YouTube":"Conectar YouTube"}</a>}
              {(youtube.connected||youtube.requiresReconnect)&&<button className="im-ghost im-danger" disabled={saving} onClick={()=>setShowYouTubeDisconnect(true)}>Desvincular YouTube</button>}
            </div>
          </div>}

          <div className="im-card im-profile-config">
            <div className="im-card-head"><div><span className="im-kicker">CONFIGURAÇÃO DO PERFIL</span><h2>Identidade e publicação</h2><p>Configurações exclusivas deste perfil.</p></div></div>

            {!isYouTube&&<div className="im-config-section">
              <div className="im-config-section-head"><div><span className="im-kicker">IDENTIDADE</span><h3>Capa do perfil</h3><p>Capa usada nos Reels publicados por este perfil.</p></div></div>
              <div className="im-cover-upload">
                <label>Arquivo da capa<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0]||null;setCoverFile(f);setCoverPreview(f?URL.createObjectURL(f):"");}} /></label>
                <div className="im-cover-row">
                  <div className="im-cover-frame">{(coverPreview||coverUrl)?<img className="im-cover-preview" src={coverPreview||coverUrl} alt={"Capa de "+selected.name}/>:<div className="im-cover-empty"><span>9:16</span><small>PRÉVIA DA CAPA</small></div>}</div>
                  <div className="im-cover-meta"><strong>{coverFile?.name||selected.cover_r2_key?"Capa configurada":"Escolha uma capa vertical"}</strong><span>A capa é uma configuração do perfil.</span><button type="button" className="im-primary" disabled={!coverFile||saving} onClick={()=>void uploadCover()}>{saving?"Enviando…":"Salvar capa"}</button></div>
                </div>
                <small>JPG, PNG ou WEBP · até 5 MB.</small>
              </div>
            </div>}

            <div className="im-config-section">
              <div className="im-config-section-head"><div><span className="im-kicker">TEXTO DA PUBLICAÇÃO</span><h3>{isYouTube?"Título e descrição":"Nome e descrição"}</h3><p>{isYouTube?"Usados em todos os Shorts deste perfil. Em branco, cada vídeo usa o próprio texto.":"Texto usado nas publicações deste perfil."}</p></div></div>
              <div className="im-fixed-copy">
                <label>{isYouTube?"Título do Short":"Nome do Reel"}<input value={draft.fixed_publish_title} maxLength={isYouTube?92:undefined} onChange={e=>setDraft(v=>({...v,fixed_publish_title:e.target.value}))} placeholder={isYouTube?"Título original do vídeo":"Automático"} /></label>
                <label>Descrição<textarea rows={5} value={draft.fixed_publish_description} onChange={e=>setDraft(v=>({...v,fixed_publish_description:e.target.value}))} placeholder={isYouTube?"Opcional":"Automática em chinês/japonês"} /></label>
              </div>
              {!isYouTube&&<><label className="im-check"><input type="checkbox" checked={draft.share_to_feed} onChange={e=>setDraft(v=>({...v,share_to_feed:e.target.checked}))}/><span>Mostrar também na Grade do Instagram</span></label>
              <div className="im-story-settings"><label className="im-check"><input type="checkbox" checked={draft.auto_story} onChange={e=>setDraft(v=>({...v,auto_story:e.target.checked}))}/><span>Compartilhar o Reel no Story automaticamente</span></label>{draft.auto_story&&<label>Publicar Story após (minutos)<input type="number" min="0" max="1440" step="1" value={draft.story_delay_minutes} onChange={e=>setDraft(v=>({...v,story_delay_minutes:Math.min(1440,Math.max(0,Number(e.target.value)||0))}))}/><small className="im-field-help">Ex.: 30 = Reel agora e Story 30 minutos depois.</small></label>}</div></>}
            </div>

            <div className="im-config-section">
              <div className="im-config-section-head"><div><span className="im-kicker">PUBLICAÇÃO</span><h3>Regras e horários</h3><p>Frequência, horários e comportamento da fila.</p></div><span className={"im-status "+(selected.publishing_enabled?"available":"archived")}>{selected.publishing_enabled?"EXECUTANDO":"PARADA"}</span></div>
              <div className="im-settings-grid">
                <label>{videoUnit} por dia<select className="im-form-select" value={draft.posts_per_day} onChange={e=>setDraft(v=>({...v,posts_per_day:Number(e.target.value)}))}>{[1,2,3,4,5,6,7,8,9].map(n=><option key={n}>{n}</option>)}</select></label>
                {!isYouTube&&<label>Idioma do texto automático<select className="im-form-select" value={draft.caption_mode} onChange={e=>setDraft(v=>({...v,caption_mode:e.target.value}))}><option value="zh_ja_random">Chinês + Japonês aleatório</option><option value="zh_random">Chinês</option><option value="ja_random">Japonês</option><option value="custom">Banco personalizado</option></select></label>}
              </div>
              <div className="im-times"><span className="im-kicker">HORÁRIOS DIÁRIOS</span><div className="im-time-grid">{Array.from({length:draft.posts_per_day},(_,i)=><label key={i}>Post {i+1}<input type="time" value={draft.posting_times[i]||DEFAULT_TIMES[i]} onChange={e=>setDraft(v=>{const times=[...v.posting_times];while(times.length<v.posts_per_day)times.push("");times[i]=e.target.value;return {...v,posting_times:times};})}/></label>)}</div></div>
              <div className="im-publish-controls">
                <button className="im-primary" disabled={saving||selected.publishing_enabled||!accountConnected} title={accountConnected?undefined:"Conecte "+(isYouTube?"o canal do YouTube":"o Instagram")+" deste perfil primeiro."} onClick={()=>void togglePublishing()}>▶ Ativar publicação automática</button>
                <button className="im-ghost" disabled={saving||!selected.publishing_enabled} onClick={()=>void togglePublishing()}>■ Desativar publicação</button>
                <label className="im-check im-repeat-toggle"><input type="checkbox" checked={draft.repeat_when_exhausted} onChange={e=>setDraft(v=>({...v,repeat_when_exhausted:e.target.checked}))}/><span>Repetir biblioteca quando acabar</span></label>
              </div>
              <div className="im-publish-status">
                <div><span>Próxima publicação</span><strong>{selected.publishing_enabled&&selected.next_publish_at?formatDateTime(selected.next_publish_at):"—"}</strong></div>
                <div><span>{selected.last_publish_status?PUBLISH_STATUS_LABEL[selected.last_publish_status]||"Último resultado":"Último resultado"}</span><strong className={"im-publish-status-"+(selected.last_publish_status||"none")}>{selected.last_publish_message||"Nenhuma publicação automática ainda."}</strong>{selected.last_publish_at&&<small>{formatDateTime(selected.last_publish_at)}</small>}</div>
                <button className="im-ghost" type="button" disabled={saving||publishingNow||!accountConnected} onClick={()=>void publishNextNow()}>{publishingNow?"Publicando…":"Publicar o próximo agora"}</button>
              </div>
              {failedItems.length>0&&<div className="im-form-note im-failed-publication">
                <span>{failedItems.length===1?"1 vídeo falhou 3 vezes ao publicar e saiu da fila":`${failedItems.length} vídeos falharam 3 vezes ao publicar e saíram da fila`}{failedItems[0]?.error_message?` (último erro: ${failedItems[0].error_message.slice(0,140)})`:""}.</span>
                <button className="im-ghost" type="button" disabled={saving} onClick={()=>void retryAllFailed()}>Tentar de novo</button>
              </div>}
              {!accountConnected&&!selected.publishing_enabled&&<div className="im-form-note">Conecte {isYouTube?"o canal do YouTube":"o Instagram"} deste perfil para ativar a publicação automática.</div>}
              <div className="im-profile-save"><button className="im-primary" type="button" disabled={saving} onClick={()=>void saveProfile()}>{saving?"Salvando…":"Salvar alterações do perfil"}</button></div>
            </div>
          </div>

          <div className="im-card im-agenda">
            <div className="im-card-head">
              <div><span className="im-kicker">AGENDA E HISTÓRICO</span><h2>Publicações</h2><p>Acompanhe a fila e o histórico de publicações automáticas deste perfil.</p></div>
            </div>
            <div className="im-agenda-grid">
              <div className="im-agenda-column">
                <div className="im-agenda-title"><strong>Próximos horários</strong><span>{draft.repeat_when_exhausted&&queuePreview.length?"repetição ativa":queuePreview.length+" na fila"}</span></div>
                {!selected.publishing_enabled ? <div className="im-agenda-empty"><strong>Publicação automática desativada</strong><span>Ative a publicação automática para visualizar a próxima sequência.</span></div>
                : queuePreview.length===0 ? <div className="im-agenda-empty"><strong>Nenhum vídeo disponível para a fila</strong><span>{items.length===0 ? (linked.length===0 ? "Vincule uma biblioteca a este perfil e adicione vídeos a ela." : "As bibliotecas vinculadas ainda não têm vídeos prontos.") : draft.repeat_when_exhausted ? "A biblioteca será repetida quando houver conteúdo publicado." : "Todos os vídeos já foram publicados neste perfil. Ative \"Repetir biblioteca quando acabar\" para reutilizá-los."}</span></div>
                : <div className="im-agenda-list">{queuePreview.map((slot,index)=>{const postNumber=published+index+1;const repeated=slot.item.status==="published"||index>=items.filter(i=>i.status==="available").length;return <div className={"im-agenda-row "+(index===0?"is-next":"")} key={slot.at.toISOString()+"-"+index}><span>{index===0?"PRÓXIMO #"+postNumber:"#"+postNumber}</span><strong>{new Intl.DateTimeFormat("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(slot.at)}</strong><small>{(slot.item.title||"Próximo vídeo")+(repeated?" · repetição":"")}</small></div>})}</div>}
              </div>
              <div className="im-agenda-column">
                <div className="im-agenda-title"><strong>Últimas publicações</strong><span>{published} publicadas</span></div>
                {published===0 ? <div className="im-agenda-empty">Ainda não há publicações registradas.</div>
                : <div className="im-agenda-list">{items.filter(i=>i.status==="published").sort((a,b)=>String(b.published_at||b.created_at).localeCompare(String(a.published_at||a.created_at))).slice(0,6).map(item=><div className="im-agenda-row" key={"history-"+item.id}><span>PUBLICADO</span><strong>{item.published_at?new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Cuiaba"}).format(new Date(item.published_at)):"—"}</strong><small>{item.title||"Vídeo sem título"}</small></div>)}</div>}
              </div>
            </div>
          </div>

          <div className="im-card im-profile-libraries">
            <div className="im-card-head"><div><span className="im-kicker">ACESSO AO CONTEÚDO</span><h2>Bibliotecas vinculadas</h2><p>Escolha quais bibliotecas este perfil pode publicar. A organização dos vídeos fica em Bibliotecas.</p></div><a className="im-ghost" href="/influencer-manager/libraries">Abrir Bibliotecas</a></div>
            {libraries.length===0?<div className="im-empty">Nenhuma biblioteca criada. Crie uma na aba Bibliotecas.</div>:<div className="im-profile-modal-list">
              {libraries.map(l=>{const isLinked=l.profiles.some(p=>p.profile_id===selected.id&&p.enabled);return <div className="im-profile" key={l.id}>
                <span className="im-avatar">{l.name.slice(0,1).toUpperCase()}</span>
                <span><strong>{l.name}</strong><small>{l.item_count} {l.item_count===1?"vídeo":"vídeos"} · {l.profiles.filter(p=>p.enabled).length} {l.profiles.filter(p=>p.enabled).length===1?"perfil":"perfis"} vinculados</small></span>
                <button className={isLinked?"im-ghost im-danger":"im-primary"} type="button" disabled={librarySaving} onClick={()=>void toggleLibrary(l)}>{isLinked?"Desvincular":"Vincular"}</button>
              </div>})}
            </div>}
            <div className="im-form-note">Vincular uma biblioteca não move, duplica ou compartilha vídeos.</div>
          </div>

          <div className="im-card im-analytics-card im-analytics-modern">
            <div className="im-card-head im-analytics-heading">
              <div><span className="im-kicker">ANALYTICS / {PLATFORM_LABEL[platform].toUpperCase()}</span><h2>Desempenho dos {videoUnit}</h2><p>Métricas reais das publicações, organizadas por tipo de conteúdo.</p></div>
              <button className="im-primary im-analytics-refresh" type="button" disabled={!selected||analyticsLoading||!accountConnected} onClick={()=>selected&&void loadAnalytics(selected.id,true)}>{analyticsLoading?"Sincronizando…":"↻ Atualizar métricas"}</button>
            </div>
            {analyticsMessage&&<div className="im-analytics-diagnostics"><span className="im-analytics-pulse"/><span>{analyticsMessage}</span></div>}
            {!analytics.metrics.length?<div className="im-empty"><strong>Nenhuma métrica coletada ainda.</strong><span>{isYouTube?"As métricas aparecem aqui depois do primeiro Short publicado por este perfil.":"Conecte o Instagram e sincronize os Insights das publicações."}</span></div>:
            <>
              <div className="im-analytics-coverage">
                <div><span>{videoUnit.toUpperCase()} PUBLICADOS</span><strong>{analytics.publishedSummary.total.toLocaleString("pt-BR")}</strong></div>
                <div><span>COM ID DO {PLATFORM_LABEL[platform].toUpperCase()}</span><strong>{analytics.publishedSummary.withInstagramId.toLocaleString("pt-BR")}</strong></div>
                <div><span>COM MÉTRICAS</span><strong>{analytics.publishedSummary.withMetrics.toLocaleString("pt-BR")}</strong></div>
              </div>
              <div className="im-stats im-analytics-kpis">
                <div><span>VISUALIZAÇÕES</span><strong>{Number(analytics.totals.views||0).toLocaleString("pt-BR")}</strong><small>Somatório dos {videoUnit} sincronizados</small></div>
                {isYouTube
                  ? <div><span>COMENTÁRIOS</span><strong>{Number(analytics.totals.comments||0).toLocaleString("pt-BR")}</strong><small>Comentários registrados</small></div>
                  : <div><span>COMPARTILHAMENTOS</span><strong>{Number(analytics.totals.shares||0).toLocaleString("pt-BR")}</strong><small>Compartilhamentos registrados</small></div>}
                <div><span>CURTIDAS</span><strong>{Number(analytics.totals.likes||0).toLocaleString("pt-BR")}</strong><small>Curtidas registradas</small></div>
                {isYouTube
                  ? <div><span>MÉDIA POR SHORT</span><strong>{analytics.metrics.length?Math.round(Number(analytics.totals.views||0)/analytics.metrics.length).toLocaleString("pt-BR"):"—"}</strong><small>Visualizações por Short publicado</small></div>
                  : <div><span>SEGUIDORES ATRIBUÍDOS</span><strong>{analytics.metricCoverage.follows===0?"—":Number(analytics.totals.follows||0).toLocaleString("pt-BR")}</strong><small>{analytics.metricCoverage.follows===0?"Métrica não retornada pelo Instagram":"Em "+analytics.metricCoverage.follows+" Reels com dado"}</small></div>}
              </div>
              <div className="im-analytics-section-title"><div><span className="im-kicker">BIBLIOTECA DE DESEMPENHO</span><h3>{videoUnit} por tipo de conteúdo</h3></div><span>{analytics.publishedSummary.total} publicados</span></div>
              <div className="im-analytics-groups">
                {analytics.categoryTotals.map((group:any)=>{
                  const reels=analytics.publishedReels.filter((reel:any)=>String(reel.category||"OUTROS")===String(group.category||"OUTROS")).sort((a:any,b:any)=>Number(b.hasMetrics)-Number(a.hasMetrics)||Number(b.views||0)-Number(a.views||0));
                  return <details className="im-analytics-group" key={group.category}>
                    <summary className="im-analytics-group-head">
                      <span className="im-analytics-category-mark">{String(group.category||"OUTROS").slice(0,1)}</span>
                      <span className="im-analytics-group-name"><strong>{group.category||"OUTROS"}</strong><small>{group.videos} {group.videos===1?(isYouTube?"Short":"Reel"):videoUnit} · {group.withMetrics} com métricas</small></span>
                      <span className="im-analytics-group-stat"><strong>{Number(group.views||0).toLocaleString("pt-BR")}</strong><small>views</small></span>
                      {isYouTube
                        ? <span className="im-analytics-group-stat"><strong>{Number(group.likes||0).toLocaleString("pt-BR")}</strong><small>curtidas</small></span>
                        : <span className="im-analytics-group-stat"><strong>{Number(group.shares||0).toLocaleString("pt-BR")}</strong><small>shares</small></span>}
                      <span className="im-analytics-chevron" aria-hidden="true">⌄</span>
                    </summary>
                    <div className="im-analytics-reels">
                      {reels.map((reel:any,index:number)=><div className="im-analytics-reel" key={reel.id}>
                        <span className="im-analytics-reel-rank">{String(index+1).padStart(2,"0")}</span>
                        <div className="im-analytics-reel-copy"><strong>{reel.title||"Vídeo sem título"}</strong><span>{reel.hasMetrics?"Atualizado "+(reel.fetched_at?new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Cuiaba"}).format(new Date(reel.fetched_at)):"—"):(isYouTube?"Sem métricas: o vídeo pode ter sido removido do canal":"Aguardando ID ou Insights do Instagram")}</span></div>
                        <div className="im-analytics-reel-metric"><strong>{reel.views===null?"—":Number(reel.views||0).toLocaleString("pt-BR")}</strong><small>views</small></div>
                        <div className="im-analytics-reel-metric"><strong>{reel.likes===null?"—":Number(reel.likes||0).toLocaleString("pt-BR")}</strong><small>curtidas</small></div>
                        {isYouTube
                          ? <div className="im-analytics-reel-metric"><strong>{reel.comments===null?"—":Number(reel.comments||0).toLocaleString("pt-BR")}</strong><small>comentários</small></div>
                          : <div className="im-analytics-reel-metric"><strong>{reel.shares===null?"—":Number(reel.shares||0).toLocaleString("pt-BR")}</strong><small>shares</small></div>}
                      </div>)}
                    </div>
                  </details>;
                })}
              </div>
              <div className="im-analytics-footnote">{isYouTube?"Todos os Shorts publicados são listados por tipo de conteúdo, incluindo os vídeos repetidos. Os números vêm direto do YouTube a cada atualização.":"Todos os Reels publicados são listados por tipo de conteúdo. Traços indicam publicações sem métricas disponíveis; os totais somam somente os Insights coletados."}</div>
            </>}
          </div>
        </>}
      </section>
    </section>

    {showFeedback&&<div className="im-modal-backdrop im-feedback-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={e=>{if(e.target===e.currentTarget)setShowFeedback(false)}}>
      <div className="im-modal im-feedback-modal">
        <div className="im-feedback-icon">!</div>
        <div className="im-feedback-copy"><span className="im-kicker">ATENÇÃO</span><h2 id="feedback-title">{feedbackTitle}</h2><p>{feedbackMessage}</p></div>
        <button className="im-primary" type="button" onClick={()=>setShowFeedback(false)}>Fechar</button>
      </div>
    </div>}
    {showYouTubeDisconnect&&selected&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="desvincular-youtube-title" onMouseDown={e=>{if(e.target===e.currentTarget)setShowYouTubeDisconnect(false)}}>
      <div className="im-modal im-confirm-modal">
        <div className="im-confirm-icon">!</div>
        <div><span className="im-kicker">DESVINCULAR YOUTUBE</span><h2 id="desvincular-youtube-title">Desvincular este canal?</h2><p>A publicação automática deste perfil será interrompida. Os vídeos já publicados continuam no canal.</p></div>
        <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowYouTubeDisconnect(false)}>Cancelar</button><button className="im-primary im-danger-solid" type="button" disabled={saving} onClick={()=>void disconnectYouTube()}>Desvincular YouTube</button></div>
      </div>
    </div>}
    {showDisconnectConfirm&&selected&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="desvincular-instagram-title" onMouseDown={e=>{if(e.target===e.currentTarget)setShowDisconnectConfirm(false)}}>
      <div className="im-modal im-confirm-modal">
        <div className="im-confirm-icon">!</div>
        <div><span className="im-kicker">DESVINCULAR INSTAGRAM</span><h2 id="desvincular-instagram-title">Desvincular esta conta?</h2><p>A publicação automática deste perfil será interrompida. O perfil e as bibliotecas permanecerão intactos.</p></div>
        <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowDisconnectConfirm(false)}>Cancelar</button><button className="im-primary im-danger-solid" type="button" disabled={saving} onClick={()=>void disconnectInstagram()}>Desvincular Instagram</button></div>
      </div>
    </div>}
    {showDeleteProfile&&selected&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="excluir-perfil-title">
      <div className="im-modal im-confirm-modal"><div className="im-confirm-icon">!</div><div><span className="im-kicker">EXCLUIR PERFIL</span><h2 id="excluir-perfil-title">Excluir “{selected.name}”?</h2><p>O perfil será excluído. As bibliotecas e os vídeos não serão excluídos por esta ação.</p></div>
        <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowDeleteProfile(false)}>Cancelar</button><button className="im-primary im-danger-solid" type="button" disabled={saving} onClick={()=>void confirmDeleteProfile()}>{saving?"Excluindo…":"Excluir perfil"}</button></div>
      </div>
    </div>}
    {showEditProfile&&selected&&<div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="editar-perfil-title">
      <div className="im-modal im-standard-modal">
        <div className="im-card-head"><div><span className="im-kicker">EDITAR PERFIL</span><h2 id="editar-perfil-title">Nome do perfil</h2><p>Altere apenas a identidade do perfil. As regras de publicação continuam preservadas.</p></div><button className="im-ghost" type="button" onClick={()=>setShowEditProfile(false)}>Fechar</button></div>
        <form className="im-modal-form" onSubmit={saveProfileName}>
          <label>Nome do perfil<input value={editProfileName} onChange={e=>setEditProfileName(e.target.value)} maxLength={80} required autoFocus /></label>
          <div className="im-modal-actions"><button className="im-ghost" type="button" onClick={()=>setShowEditProfile(false)}>Cancelar</button><button className="im-primary" disabled={saving}>{saving?"Salvando…":"Salvar nome"}</button></div>
        </form>
      </div>
    </div>}
    {showProfiles&&<div className="im-modal-backdrop" role="dialog" aria-modal="true">
      <div className="im-modal im-profiles-modal-card">
        <div className="im-card-head"><div><span className="im-kicker">SEUS PERFIS</span><h2>Escolha um perfil</h2><p>Selecione o perfil que você quer configurar.</p></div><button className="im-ghost" onClick={()=>setShowProfiles(false)}>Fechar</button></div>
        {profiles.length===0?<div className="im-empty">Nenhum perfil cadastrado.</div>:<div className="im-profile-modal-list">{profiles.map(p=><button key={p.id} className={"im-profile "+(selected?.id===p.id?"active":"")} onClick={()=>{setSelected(p);setShowProfiles(false)}}><span className="im-avatar">{p.name.slice(0,1).toUpperCase()}</span><span><strong>{p.name}</strong><small>{platformOf(p)==="youtube"?"YouTube · "+(p.youtube_channel_title||"canal não conectado"):"Instagram · "+(p.instagram_username?"@"+p.instagram_username:"conta não conectada")}</small></span></button>)}</div>}
        <button className="im-primary im-modal-new-profile" onClick={()=>{setShowProfiles(false);setShowNew(true)}}>+ Novo perfil</button>
      </div>
    </div>}
  </main>;
}
