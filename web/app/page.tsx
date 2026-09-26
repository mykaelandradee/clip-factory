"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/client";

const GENERATION_ONLY_MODE = process.env.NEXT_PUBLIC_CLIP_FACTORY_GENERATION_ONLY === "true";

type Job = {
  status: string;
  progress: number;
  stage?: string;
  message: string;
  error?: string;
  result?: { files?: Array<{ file: string; url: string }>; downloadUrl?: string };
};

const CAPTION_TEMPLATES = [
  ["karaoke", "Karaoke", "Word-sync limpo com destaque amarelo"],
  ["fire", "Fire", "Condensada, laranja e de alto impacto"],
  ["beasty", "Beasty", "Monoespaçada, pesada e agressiva"],
  ["youshaei", "Youshaei", "Editorial, espaçada com destaque cyan"],
  ["harmozi", "Harmozi", "Bold condensada com ênfase verde"],
  ["cinematic", "Cinematic", "Serifada, discreta e elegante"],
] as const;

const idMap = {
  karaoke: true,
  fire: true,
  beasty: true,
  youshaei: true,
  harmozi: true,
  cinematic: true,
};

function CaptionPreview({ id }: { id: string }) {
  const content = {
    karaoke: <><i>ISSO</i> <b>MUDA</b> <i>TUDO</i></>,
    fire: <><i>ISSO</i> <b>MUDA</b> <i>TUDO</i></>,
    beasty: <><i>ISSO</i> <b>MUDA</b> <i>TUDO</i></>,
    youshaei: <><i>ISSO</i> <b>MUDA</b> <i>TUDO</i></>,
    harmozi: <><i>ISSO</i> <b>MUDA</b> <i>TUDO</i></>,
    cinematic: <><i>isso</i> <b>muda</b> <i>tudo</i></>,
  }[id as keyof typeof idMap];
  return (
    <div className={`cf-template-preview accent-${id}`}>
      <span className="preview-top">9:16 • LIVE PREVIEW</span>
      <span className="preview-context">VOCÊ PRECISA VER ISSO</span>
      <span className="preview-subtitle">{content}</span>
      <span className="preview-progress"><span /></span>
      <span className="preview-style-mark">{id}</span>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<{title:string;author:string;thumbnail:string}|null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [clips, setClips] = useState("3");
  const [duration, setDuration] = useState("30-60");
  const [subtitleLanguage, setSubtitleLanguage] = useState("original");
  const [captionStyle, setCaptionStyle] = useState("karaoke");
  const [workerOnline, setWorkerOnline] = useState(false);
  const [jobId, setJobId] = useState("");
  const [jobAccessToken, setJobAccessToken] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [showAuthInfo, setShowAuthInfo] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState("");
  const [publishingTarget, setPublishingTarget] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState("");
  const [publishStatuses, setPublishStatuses] = useState<Record<string, { platform: "youtube" | "instagram"; status: "queued" | "running" | "success" | "failed"; message: string }>>({});
  const publishTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [publishDrafts, setPublishDrafts] = useState<Record<string, { title: string; description: string; publishAt: string }>>({});
  const [previewClip, setPreviewClip] = useState<{ file: string; url: string; index: number; currentTime: number } | null>(null);
  const [previewErrors, setPreviewErrors] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const emptyResultRetries = useRef(0);
  const pollStartedAt = useRef(0);
  const CLIENT_JOB_TIMEOUT_MS = 50 * 60 * 1000;

  async function readJsonResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
    const raw = await response.text();
    if (!raw.trim()) {
      throw new Error(
        response.ok
          ? "O servidor respondeu sem dados. Tente novamente."
          : `O servidor respondeu com HTTP ${response.status}, mas sem uma mensagem de erro.`,
      );
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(
        response.ok
          ? "O servidor retornou uma resposta inválida."
          : `O servidor respondeu com HTTP ${response.status} em um formato inesperado.`,
      );
    }
  }

  const selectedTemplate = CAPTION_TEMPLATES.find(([id]) => id === captionStyle) ?? CAPTION_TEMPLATES[0];

  function getProgressStage(progress: number, stage?: string) {
    if (progress >= 100) return "Concluído";
    const normalized = (stage || "").toLowerCase();
    if (normalized.includes("render")) return "Renderizando clips";
    if (normalized.includes("transcrib")) return "Transcrevendo áudio";
    if (normalized.includes("translat")) return "Traduzindo legendas";
    if (normalized.includes("analy") || normalized.includes("select")) return "Encontrando melhores momentos";
    if (normalized.includes("download")) return "Baixando e analisando vídeo";
    if (normalized.includes("upload")) return "Enviando clips para o R2";
    if (progress >= 90) return "Finalizando";
    if (progress >= 70) return "Renderizando clips";
    if (progress >= 45) return "Encontrando melhores momentos";
    if (progress >= 20) return "Transcrevendo áudio";
    return "Baixando e analisando vídeo";
  }

  async function retryJob() {
    if (!jobId || retrying) return;
    setRetrying(true);
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, accessToken: jobAccessToken || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível tentar novamente.");
      pollStartedAt.current = Date.now();
      setJob({
        status: "processing",
        progress: 5,
        stage: "queued",
        message: data.message || "Nova tentativa iniciada.",
      });
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => poll(jobId, jobAccessToken), 3000);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Não foi possível tentar novamente.");
    } finally {
      setRetrying(false);
    }
  }

  function startNewGeneration() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setJob(null);
    setJobId("");
    setJobAccessToken("");
    setError("");
    setPreviewErrors({});
    setPreviewClip(null);
    setPublishDrafts({});
    setPublishStatuses({});
    setPublishMessage("");
    setPublishingTarget(null);
    emptyResultRetries.current = 0;
    pollStartedAt.current = 0;
    setSubmitting(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!GENERATION_ONLY_MODE) initAuth();
    checkWorker();
    return () => { if (timer.current) clearInterval(timer.current); if (publishTimer.current) clearInterval(publishTimer.current); };
  }, []);

  useEffect(() => {
    setVideoInfo(null);
    if (!url.trim()) return;
    const timeout = setTimeout(async () => {
      try {
        setLoadingInfo(true);
        const response = await fetch("/api/youtube-info?url=" + encodeURIComponent(url.trim()), { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (data.title && data.thumbnail) setVideoInfo(data);
      } catch {
        setVideoInfo(null);
      } finally {
        setLoadingInfo(false);
      }
    }, 450);
    return () => clearTimeout(timeout);
  }, [url]);

  async function initAuth() {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setUser(data.user ?? null);
      if (data.user) {
        await checkYouTube();
        await checkInstagram();
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get("auth_error") === "session_required") setAuthMessage("Entre no Clip Factory para conectar YouTube ou Instagram.");
      else if (params.get("auth_error")) setAuthMessage("Não foi possível concluir a autenticação. Tente novamente.");
      if (params.get("instagram_connected") === "1") setAuthMessage("Instagram conectado com sucesso.");
      if (params.get("instagram_error")) setAuthMessage("Não foi possível conectar o Instagram. Verifique a configuração e tente novamente.");
      supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          checkYouTube();
          checkInstagram();
        } else {
          setYoutubeConnected(false);
          setInstagramConnected(false);
        }
      });
    } catch {
      setAuthMessage("Autenticação ainda não está configurada.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      setUser(null);
      setYoutubeConnected(false);
      setInstagramConnected(false);
    } catch {
      setAuthMessage("Não foi possível sair.");
    }
  }

  async function checkInstagram() {
    try {
      const response = await fetch("/api/instagram/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setInstagramConnected(Boolean(data.connected));
    } catch {
      setInstagramConnected(false);
    }
  }

  async function checkYouTube() {
    try {
      const response = await fetch("/api/youtube/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setYoutubeConnected(Boolean(data.connected));
    } catch {
      setYoutubeConnected(false);
    }
  }

  async function pasteYouTubeUrl() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      setError("Não foi possível acessar a área de transferência. Cole o link no campo.");
    }
  }

  function defaultPublishTitle(index: number) {
    return videoInfo?.title || "Clip Factory · Clip " + (index + 1);
  }

  function getPublishDraft(file: string, index: number) {
    return publishDrafts[file] ?? {
      title: defaultPublishTitle(index),
      description: "Criado com o Clip Factory.",
      publishAt: "",
    };
  }

  function updatePublishDraft(file: string, index: number, field: "title" | "description" | "publishAt", value: string) {
    const current = getPublishDraft(file, index);
    setPublishDrafts((previous) => ({
      ...previous,
      [file]: { ...current, [field]: value },
    }));
  }

  async function publishToYouTube(file: string, index: number) {
    if (publishTimer.current) clearInterval(publishTimer.current);
    setPublishingTarget(`youtube:${file}`);
    const draft = getPublishDraft(file, index);
    const setStatus = (status: "queued" | "running" | "success" | "failed", message: string) =>
      setPublishStatuses((previous) => ({ ...previous, [file]: { platform: "youtube", status, message } }));
    try {
      const response = await fetch("/api/youtube/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          file,
          title: draft.title.trim(),
          description: draft.description,
          publishAt: draft.publishAt ? new Date(draft.publishAt).toISOString() : "",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar a publicação no YouTube.");
      setStatus("queued", draft.publishAt ? "Publicação agendada no YouTube. Aguardando o GitHub Actions." : "Publicação iniciada no YouTube. Aguardando o envio.");
      const check = async () => {
        try {
          const statusQuery = new URLSearchParams({
            platform: "youtube",
            jobId,
            file,
            ...(data.runId ? { runId: String(data.runId) } : {}),
            ...(data.startedAt ? { startedAt: String(data.startedAt) } : {}),
          });
          const statusResponse = await fetch(`/api/publish/status?${statusQuery.toString()}`, { cache: "no-store" });
          const statusData = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusData.error || "Não foi possível consultar a publicação.");
          if (statusData.status === "success") {
            setStatus("success", draft.publishAt ? "Publicação agendada com sucesso no YouTube." : "Vídeo publicado com sucesso no YouTube.");
            if (publishTimer.current) clearInterval(publishTimer.current);
            publishTimer.current = null;
            setPublishingTarget(null);
            return false;
          } else if (statusData.status === "failed") {
            setStatus("failed", statusData.message || "A publicação no YouTube falhou.");
            if (publishTimer.current) clearInterval(publishTimer.current);
            publishTimer.current = null;
            setPublishingTarget(null);
            return false;
          } else {
            setStatus(statusData.status === "running" ? "running" : "queued", statusData.message || "Publicação em andamento no YouTube.");
            return true;
          }
        } catch (err) {
          setStatus("running", err instanceof Error ? err.message : "Consultando a publicação...");
          return true;
        }
      };
      const shouldKeepPolling = await check();
      if (shouldKeepPolling) {
        publishTimer.current = setInterval(check, 3000);
      }
    } catch (err) {
      setStatus("failed", err instanceof Error ? err.message : "Erro ao publicar no YouTube.");
      setPublishingTarget(null);
    }
  }

  async function publishToInstagram(file: string, index: number) {
    if (publishTimer.current) clearInterval(publishTimer.current);
    setPublishingTarget(`instagram:${file}`);
    setPublishStatuses((previous) => ({ ...previous, [file]: { platform: "instagram", status: "running", message: "Enviando o Reel para o Instagram..." } }));
    const draft = getPublishDraft(file, index);
    const caption = [draft.title.trim(), draft.description.trim()].filter(Boolean).join("\n");
    try {
      const response = await fetch("/api/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, file, caption }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível publicar no Instagram.");
      setPublishStatuses((previous) => ({ ...previous, [file]: { platform: "instagram", status: "success", message: data.message || "Reel publicado com sucesso no Instagram." } }));
    } catch (err) {
      setPublishStatuses((previous) => ({ ...previous, [file]: { platform: "instagram", status: "failed", message: err instanceof Error ? err.message : "Erro ao publicar no Instagram." } }));
    } finally {
      setPublishingTarget(null);
    }
  }
  async function checkWorker() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setWorkerOnline(response.ok);
    } catch { setWorkerOnline(false); }
  }

  async function poll(id: string, accessTokenOverride?: string) {
    try {
      if (pollStartedAt.current && Date.now() - pollStartedAt.current > CLIENT_JOB_TIMEOUT_MS) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setSubmitting(false);
        setJob((previous) => previous ? { ...previous, status: "failed", message: "O processamento demorou mais que o esperado. Você pode tentar novamente." } : previous);
        setError("O processamento excedeu o tempo máximo de espera da interface. O worker pode ainda estar concluindo; aguarde alguns instantes antes de tentar novamente.");
        return;
      }
      const query = new URLSearchParams({ id });
      const response = await fetch("/api/jobs?" + query.toString(), {
        cache: "no-store",
        headers: (accessTokenOverride || jobAccessToken) ? { Authorization: `Bearer ${accessTokenOverride || jobAccessToken}` } : undefined,
      });
      if (!response.ok) throw new Error("Não foi possível consultar o processamento.");
      const data = await response.json() as Job;
      setError("");
      setJob(data);
      setWorkerOnline(true);
      if (data.status === "completed") {
        const files = data.result?.files ?? [];
        if (files.length === 0 && emptyResultRetries.current < 5) {
          emptyResultRetries.current += 1;
          setSubmitting(true);
          return;
        }
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setSubmitting(false);
        emptyResultRetries.current = 0;
      } else if (data.status === "failed") {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setSubmitting(false);
        emptyResultRetries.current = 0;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao consultar o processamento.");
    }
  }

  function downloadAllClips() {
    const files = job?.result?.files ?? [];
    files.forEach((item, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = item.url;
        link.download = item.file;
        link.target = "_blank";
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 350);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setJob(null);
    setJobId("");
    setJobAccessToken("");
    setPublishDrafts({});
    setPublishStatuses({});
    setPublishMessage("");
    setPublishingTarget(null);
    if (timer.current) clearInterval(timer.current);
    if (!url.trim()) return setError("Informe a URL do YouTube.");

    setSubmitting(true);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          count: Number(clips),
          min_duration: duration === "15-30" ? 15 : duration === "45-90" ? 45 : 30,
          max_duration: duration === "15-30" ? 30 : duration === "45-90" ? 90 : 60,
          subtitle_language: subtitleLanguage,
          caption_style: captionStyle,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = data.githubStatus ? ` (GitHub HTTP ${data.githubStatus})` : "";
        throw new Error(`${data.error || "Não foi possível iniciar o processamento."}${detail}`);
      }
      setWorkerOnline(true);
      setJobId(data.jobId);
      setJobAccessToken(data.accessToken || "");
      pollStartedAt.current = Date.now();
      setJob(data);
      timer.current = setInterval(() => poll(data.jobId, data.accessToken || ""), 3000);
    } catch (err) {
      setSubmitting(false);
      setWorkerOnline(false);
      setError(err instanceof Error ? err.message : "Não foi possível iniciar o processamento.");
    }
  }

  return (
    <main className="cf-shell">
      <div className="cf-bg-orb cf-bg-orb-a" />
      <div className="cf-bg-orb cf-bg-orb-b" />
      <div className="cf-container">
        <header className="cf-header cf-header-modern">
          <div className="cf-brand"><div className="cf-logo">CF</div><span>Clip Factory</span></div>
          <div className="cf-header-meta">
            <span className="cf-live-label">LOCAL AI PIPELINE</span>
            {!GENERATION_ONLY_MODE && <>
              {!user && !authLoading && (
                <div className="cf-auth-group">
                  <button type="button" className="cf-auth-info" onClick={() => setShowAuthInfo((value) => !value)} aria-label="Informações sobre o login">
                    <span>i</span>
                    {showAuthInfo && <span className="cf-auth-info-popover">A geração e o download dos clips são livres. O login no Clip Factory é opcional e só é necessário para conectar Google, YouTube ou Instagram e publicar.</span>}
                  </button>
                  <a className="cf-auth-button" href="/api/auth/google" aria-label="Logar no Clip Factory">
                    Logar no Clip Factory
                  </a>
                </div>
              )}
              {user && (
                <>
                  <a className="cf-youtube-button" href="/api/youtube/oauth" aria-label="Conectar YouTube">
                    <span className={`cf-yt-dot ${youtubeConnected ? "connected" : ""}`} />
                    {youtubeConnected ? "YouTube conectado" : "Conectar YouTube"}
                  </a>
                  <a className="cf-youtube-button" href="/api/instagram/oauth" aria-label="Conectar Instagram">
                    <span className={`cf-yt-dot ${instagramConnected ? "connected" : ""}`} />
                    {instagramConnected ? "Instagram conectado" : "Conectar Instagram"}
                  </a>
                  <span className="cf-account-label" title={user.email || "Conta do Clip Factory"}>Clip Factory conectado</span>
                  <button type="button" className="cf-auth-button" onClick={signOut}>Sair</button>
                </>
              )}
            </>}
            <div className={`cf-status-pill ${workerOnline ? "online" : "offline"}`}><span /> GitHub Actions {workerOnline ? "conectado" : "não configurado"}</div>
          </div>
        </header>

        {!GENERATION_ONLY_MODE && authMessage && <div className="cf-auth-message">{authMessage}</div>}
        <section className="cf-hero">
          <div className="cf-hero-copy">
            <div className="cf-hero-label"><span /> VIDEO → CLIPS → SOCIAL</div>
            <h2>Transforme seu vídeo<br /><em>em conteúdo.</em></h2>
            <p>Recorte automático, legendas animadas e formato 9:16 em um único fluxo. Sem precisar conectar uma conta para gerar.</p>
            <div className="cf-hero-pills"><span>AI CLIPPING</span><span>9:16</span><span>WORD SYNC</span><span>READY TO POST</span></div>
          </div>
          <div className="cf-hero-mark-wrap">
            <div className="cf-hero-mark"><strong>9:16</strong><span>SHORT FORM</span></div>
            <div className="cf-hero-orbit orbit-one" />
            <div className="cf-hero-orbit orbit-two" />
          </div>
        </section>

        <form className="cf-card cf-builder" onSubmit={submit}>
          <div className="cf-builder-head">
            <div><span className="cf-kicker">01 / SOURCE</span><h3>Escolha o vídeo</h3></div>
            <span className="cf-step-dot">01</span>
          </div>
          <div className="cf-grid">
            <div className="cf-field cf-source-field">
              <div className="cf-source-label"><label htmlFor="url">URL do YouTube</label><span>FONTE DO VÍDEO</span></div>
              <div className={`cf-url-box ${videoInfo ? "identified" : ""}`}>
                <span className="cf-url-icon">▶</span>
                <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." disabled={submitting} />
                <button type="button" className="cf-paste-button" onClick={pasteYouTubeUrl} disabled={submitting}>COLAR</button>
              </div>
              <div className="cf-url-hint">
                <span>{loadingInfo ? "Analisando vídeo..." : videoInfo ? "Vídeo identificado automaticamente" : "Cole um link de vídeo do YouTube"}</span>
                <span>Sem login para gerar</span>
              </div>
              {videoInfo && (
                <div className="cf-video-info">
                  <div className="cf-video-thumb-wrap"><img src={videoInfo.thumbnail} alt="" /><span>9:16</span></div>
                  <div><strong>{videoInfo.title}</strong><span>{videoInfo.author}</span><small className="cf-video-ready">● VÍDEO IDENTIFICADO</small></div>
                  <span className="cf-video-check">✓</span>
                </div>
              )}
            </div>
            <div className="cf-field">
              <label>Quantidade de clips</label>
              <div className="cf-choice-row" role="group" aria-label="Quantidade de clips">
                {["3", "5", "10", "15"].map((value) => (
                  <button type="button" key={value} className={`cf-choice ${clips === value ? "selected" : ""}`} onClick={() => setClips(value)} disabled={submitting}>
                    <strong>{value}</strong><span>clips</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="cf-field">
              <label>Idioma das legendas</label>
              <div className="cf-choice-row cf-language-row" role="group" aria-label="Idioma das legendas">
                {[
                  ["original", "Original"],
                  ["pt-BR", "PT-BR"],
                  ["en", "English"],
                ].map(([value, label]) => (
                  <button type="button" key={value} className={`cf-choice ${subtitleLanguage === value ? "selected" : ""}`} onClick={() => setSubtitleLanguage(value)} disabled={submitting}>
                    <strong>{label}</strong>
                  </button>
                ))}
              </div>
              <small>Tradução local para PT-BR, sem API paga.</small>
            </div>
          </div>

          <div className="cf-builder-head cf-section-head">
            <div><span className="cf-kicker">02 / CUT</span><h3>Defina a duração</h3></div>
            <span className="cf-section-note">Escolha o ritmo do conteúdo</span>
          </div>
          <div className="cf-duration-grid">
            {[["15-30", "15–30s"], ["30-60", "30–60s"], ["45-90", "45–90s"]].map(([id, label]) => (
              <button type="button" key={id} className={`cf-duration ${duration === id ? "selected" : ""}`} onClick={() => setDuration(id)} disabled={submitting}>
                <span className="cf-duration-num">0{id === "15-30" ? "1" : id === "30-60" ? "2" : "3"}</span>
                <strong>{label}</strong><span>clips nesta faixa</span>
              </button>
            ))}
          </div>

          <div className="cf-builder-head cf-section-head">
            <div><span className="cf-kicker">03 / STYLE</span><h3>Escolha a personalidade da legenda</h3></div>
            <span className="cf-section-note">Cada preset usa tipografia e animação próprias</span>
          </div>
          <div className="cf-template-grid">
            {CAPTION_TEMPLATES.map(([id, name, description]) => (
              <div key={id} className={`cf-template ${captionStyle === id ? "selected" : ""}`}>
                 <button type="button" className="cf-template-main" onClick={() => setCaptionStyle(id)} disabled={submitting} aria-label={`Selecionar legenda ${name}`}>
                   <div className="cf-template-number">0{CAPTION_TEMPLATES.findIndex(([templateId]) => templateId === id) + 1}</div>
                   <CaptionPreview id={id} />
                   <div className="cf-template-info"><div><strong>{name}</strong>{captionStyle === id && <span className="cf-selected-label">SELECIONADO</span>}</div><span>{description}</span></div>
                   {captionStyle === id && <span className="cf-check">✓</span>}
                 </button>
               </div>
            ))}
          </div>
          <div className={`cf-style-detail accent-${selectedTemplate[0]}`}>
            <div className="cf-style-detail-icon">✦</div>
            <div><span>PRESET SELECIONADO</span><strong>{selectedTemplate[1]}</strong><p>{selectedTemplate[2]} · maiúsculas · word-sync · 9:16</p></div>
            <div className="cf-style-wave"><i/><i/><i/><i/><i/><i/></div>
          </div>

          <div className="cf-actions">
            <button className="cf-button" type="submit" disabled={submitting}>
              <span>{submitting ? "PROCESSANDO..." : "GERAR CLIPS"}</span><b>↗</b>
            </button>
          </div>

          {jobId && job && (
            <div className="cf-job">
              <div className="cf-job-top"><div><span className="cf-job-live">PROCESSAMENTO AO VIVO</span><strong>{job.progress >= 100 ? "Concluído" : getProgressStage(job.progress, job.stage)}</strong></div><span className="cf-job-percent">{job.progress}%</span></div>
              <div className="cf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label="Progresso da geração"><div style={{ width: `${job.progress}%` }} /></div>
              <div className="cf-job-steps">
                {[[20, "ANÁLISE"], [45, "TRANSCRIÇÃO"], [70, "MOMENTOS"], [90, "RENDER"], [100, "PRONTO"]].map(([threshold, label]) => <span key={label} className={job.progress >= Number(threshold) ? "done" : ""}>{label}</span>)}
              </div>
              <small>{getProgressStage(job.progress, job.stage)} · {job.message}{jobId ? ` · Job ${jobId.slice(0, 8)}` : ""}</small>
            </div>
          )}

          {error && <p className="cf-error">{error}</p>}
          {job?.status === "failed" && (
            <div className="cf-job-failure">
              <div>
                <strong>O processamento não foi concluído.</strong>
                <span>{job.error || job.message}</span>
              </div>
              <button type="button" className="cf-retry-button" onClick={retryJob} disabled={retrying || submitting}>
                {retrying ? "TENTANDO..." : "TENTAR NOVAMENTE ↻"}
              </button>
            </div>
          )}
          
        </form>

        {job?.status === "completed" && job.result && (
          <section className="cf-results">
            <div className="cf-results-head">
              <div className="cf-results-title">
                <div className="cf-section-kicker">04 / OUTPUT</div>
                <h2>Seus clips estão prontos.</h2>
                <p><strong>{job.result.files?.length ?? 0} de {clips} clips gerados</strong> · 9:16 · hospedados no R2 e prontos para publicar.</p>
              </div>
              <div className="cf-results-head-actions">
                <div className="cf-output-badge"><span /> {job.result.files?.length ?? 0}/{clips} GERADOS</div>
                <button type="button" className="cf-button cf-button-secondary" onClick={downloadAllClips} disabled={!job.result.files?.length}>Baixar tudo <b>↓</b></button>
                <button type="button" className="cf-results-new" onClick={startNewGeneration}>+ Novo vídeo</button>
              </div>
            </div>
            <div className="cf-results-grid">
              {(job.result.files ?? []).map((r2File, index) => {
                const file = r2File.file;
                const source = r2File.url;
                const download = r2File.url;
                const previewFailed = Boolean(previewErrors[file]);
                return (
                  <article className="cf-result-card" key={file}>
                    <div className="cf-video-wrap">
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        src={source}
                        onError={() => setPreviewErrors((current) => ({ ...current, [file]: true }))}
                      />
                      <span className="cf-clip-number">0{index + 1}</span>
                      <button
                        type="button"
                        className="cf-preview-button"
                        onClick={(event) => {
                          const cardVideo = event.currentTarget.parentElement?.querySelector("video") as HTMLVideoElement | null;
                          const currentTime = cardVideo?.currentTime ?? 0;
                          if (cardVideo) cardVideo.pause();
                          setPreviewClip({ file, url: source, index, currentTime });
                        }}
                        aria-label={`Abrir preview do Clip ${index + 1}`}
                      >
                        ⛶
                      </button>
                      {previewFailed && (
                        <div className="cf-video-fallback">
                          <strong>Preview indisponível</strong>
                          <span>O arquivo foi gerado e está disponível no R2.</span>
                          <a href={source} target="_blank" rel="noreferrer">Abrir vídeo</a>
                        </div>
                      )}
                    </div>
                    <div className="cf-result-info">
                      <div className="cf-result-heading">
                        <div className="cf-result-title-row"><strong>Clip {String(index + 1).padStart(2, "0")}</strong><span className="cf-ready-dot">PRONTO · PREVIEW</span></div>
                        <span>{duration === "15-30" ? "15–30s" : duration === "45-90" ? "45–90s" : "30–60s"} · 9:16 · SHORT</span>
                      </div>
                      {!GENERATION_ONLY_MODE && (youtubeConnected || instagramConnected) && (
                        <div className="cf-publish-fields">
                          <label>
                            <span>Título do Short</span>
                            <input
                              value={getPublishDraft(file, index).title}
                              maxLength={100}
                              onChange={(e) => updatePublishDraft(file, index, "title", e.target.value)}
                              placeholder="Digite o título..."
                              disabled={publishingTarget === `youtube:${file}`}
                            />
                            <small>{getPublishDraft(file, index).title.length}/100</small>
                          </label>
                          <label>
                            <span>Descrição</span>
                            <textarea
                              value={getPublishDraft(file, index).description}
                              maxLength={5000}
                              rows={3}
                              onChange={(e) => updatePublishDraft(file, index, "description", e.target.value)}
                              placeholder="Digite a descrição..."
                              disabled={publishingTarget === `instagram:${file}`}
                            />
                            <small>{getPublishDraft(file, index).description.length}/5000</small>
                          </label>
                          {!GENERATION_ONLY_MODE && youtubeConnected && (
                            <label>
                              <span>Agendar publicação no YouTube</span>
                              <input
                                type="datetime-local"
                                value={getPublishDraft(file, index).publishAt}
                                onChange={(e) => updatePublishDraft(file, index, "publishAt", e.target.value)}
                                disabled={publishingTarget === `instagram:${file}`}
                              />
                              <small>Preencha data e horário e clique em “Agendar YouTube”. Deixe em branco para publicar imediatamente. O agendamento nesta tela é exclusivo do YouTube.</small>
                            </label>
                          )}
                        </div>
                      )}
                      {publishStatuses[file] && (
                        <div className={`cf-publish-status cf-publish-status-${publishStatuses[file].status}`}>
                          <strong>{publishStatuses[file].status === "success" ? "✓" : publishStatuses[file].status === "failed" ? "!" : "⋯"}</strong>
                          <span>{publishStatuses[file].message}</span>
                        </div>
                      )}
                      <div className="cf-result-actions">
                        <a href={download} download className="cf-download">Baixar <span>↓</span></a>
                        {!GENERATION_ONLY_MODE && youtubeConnected && (
                          <button
                            type="button"
                            className="cf-download cf-publish-button"
                            onClick={() => publishToYouTube(file, index)}
                            disabled={publishingTarget === `youtube:${file}` || publishingTarget === `instagram:${file}` || !getPublishDraft(file, index).title.trim()}
                          >
                            {publishingTarget === `youtube:${file}` ? "Enviando…" : (getPublishDraft(file, index).publishAt ? "Agendar YouTube ↗" : "Publicar YouTube ↗")}
                          </button>
                        )}
                        {!GENERATION_ONLY_MODE && instagramConnected && (
                          <button
                            type="button"
                            className="cf-download cf-publish-button"
                            onClick={() => publishToInstagram(file, index)}
                            disabled={publishingTarget === `instagram:${file}` || !getPublishDraft(file, index).title.trim()}
                          >
                            {publishingTarget === `instagram:${file}` ? "Publicando…" : "Publicar Instagram ↗"}
                          </button>
                        )}
                      </div>                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {previewClip && (
        <div
          className="cf-preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Preview do Clip ${previewClip.index + 1}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewClip(null);
          }}
        >
          <div className="cf-preview-modal-card">
            <div className="cf-preview-modal-head">
              <div>
                <span>PREVIEW</span>
                <strong>Clip {String(previewClip.index + 1).padStart(2, "0")}</strong>
              </div>
              <button type="button" className="cf-preview-close" onClick={() => setPreviewClip(null)} aria-label="Fechar preview">×</button>
            </div>
            <div className="cf-preview-modal-video">
              <video controls autoPlay playsInline preload="metadata" src={previewClip.url} onLoadedMetadata={(event) => { const video = event.currentTarget; if (previewClip.currentTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(previewClip.currentTime, Math.max(0, video.duration - 0.05)); void video.play().catch(() => {}); }} />
            </div>
            <div className="cf-preview-modal-actions">
              <a href={previewClip.url} download={previewClip.file} className="cf-download">Baixar <span>↓</span></a>
              <button type="button" className="cf-preview-close-action" onClick={() => setPreviewClip(null)}>Fechar preview</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}