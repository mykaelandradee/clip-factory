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
  ["karaoke", "Karaoke", "Bold • palavra falada em amarelo"],
  ["fire", "Fire", "Bold • palavra falada em laranja"],
  ["youshaei", "Youshaei", "Bold • palavra falada em azul"],
  ["harmozi", "Harmozi", "Bold • palavra falada em verde"],
  ["beasty", "Beasty", "Branco • palavra falada preta em box branco"],
  ["cinematic", "Cinematic", "Legenda de cinema • duas linhas"],
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
    karaoke: <><span>ISSO</span> <b>MUDA</b> <span>TUDO</span></>,
    fire: <><span>ISSO</span> <b>MUDA</b> <span>TUDO</span></>,
    youshaei: <><span>ISSO</span> <b>MUDA</b> <span>TUDO</span></>,
    harmozi: <><span>ISSO</span> <b>MUDA</b> <span>TUDO</span></>,
    beasty: <><i>ISSO</i> <span className="preview-box-word">MUDA</span> <i>TUDO</i></>,
    cinematic: <><i>ISSO TUDO</i><br/><b>MUDA A SUA VIDA</b></>,
  }[id as keyof typeof idMap];
  return (
    <div className={`cf-template-preview accent-${id}`}>
      <span className="preview-top">9:16 • PREVIEW</span>
      <span className="preview-context">EXEMPLO DE LEGENDA</span>
      <span className="preview-subtitle">{content}</span>
      <span className="preview-style-mark">{id}</span>
    </div>
  );
}

type ScheduledItem = {
  id: string;
  platform: "instagram" | "youtube";
  jobId: string;
  file: string;
  title: string;
  scheduledAt: string;
  status: string;
  caption?: string;
  videoId?: string;
  lastError?: string | null;
};

function ScheduleScreen() {
  const [items, setItems] = useState<ScheduledItem[]>([]);
  const [filter, setFilter] = useState<"all" | "instagram" | "youtube">("all");
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState("");
  const [error, setError] = useState("");

  async function loadSchedules() {
    setLoading(true);
    setError("");
    try {
      const [instagramResponse, youtubeResponse] = await Promise.all([
        fetch("/api/instagram/schedule", { cache: "no-store" }),
        fetch("/api/youtube/schedule", { cache: "no-store" }),
      ]);
      const instagramData = await instagramResponse.json().catch(() => ({}));
      const youtubeData = await youtubeResponse.json().catch(() => ({}));
      if (instagramResponse.status === 401 || youtubeResponse.status === 401) {
        setItems([]);
        setError("Entre no Clip Factory para visualizar seus agendamentos.");
        return;
      }
      if (!instagramResponse.ok && !youtubeResponse.ok) {
        throw new Error("Não foi possível carregar os agendamentos.");
      }

      const instagram: ScheduledItem[] = (instagramData.scheduledPosts || []).map((post: any) => ({
        id: post.id,
        platform: "instagram",
        jobId: post.job_id,
        file: post.file,
        title: (post.caption || "Reel do Clip Factory").split("\n")[0],
        caption: post.caption,
        scheduledAt: post.scheduled_at,
        status: post.status,
        lastError: post.last_error,
      }));
      const youtube: ScheduledItem[] = (youtubeData.scheduledPosts || []).map((post: any) => ({
        id: post.id,
        platform: "youtube",
        jobId: post.job_id,
        file: post.file,
        title: post.title || "Vídeo do Clip Factory",
        scheduledAt: post.scheduled_at,
        status: post.status,
        videoId: post.video_id,
      }));
      setItems([...instagram, ...youtube].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os agendamentos.");
    } finally {
      setLoading(false);
    }
  }

  async function cancel(item: ScheduledItem) {
    if (!window.confirm(`Deseja cancelar o agendamento do ${item.platform === "instagram" ? "Instagram" : "YouTube"}?`)) return;
    setCanceling(item.id);
    try {
      const endpoint = item.platform === "instagram" ? "/api/instagram/schedule" : "/api/youtube/schedule";
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível cancelar o agendamento.");
      await loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cancelar o agendamento.");
    } finally {
      setCanceling("");
    }
  }

  useEffect(() => {
    void loadSchedules();
  }, []);

  const visible = items.filter((item) => filter === "all" || item.platform === filter);
  const activeCount = items.filter((item) => item.status === "scheduled").length;
  const instagramCount = items.filter((item) => item.platform === "instagram" && item.status === "scheduled").length;
  const youtubeCount = items.filter((item) => item.platform === "youtube" && item.status === "scheduled").length;

  return (
    <section className="cf-schedules">
      <div className="cf-schedules-head">
        <div>
          <span className="cf-kicker">02 / SCHEDULES</span>
          <h2>Agendamentos</h2>
          <p>Gerencie em um só lugar as publicações programadas no Instagram e no YouTube.</p>
        </div>
        <div className="cf-schedules-count">
          <strong>{activeCount}</strong>
          <span>ativos</span>
        </div>
      </div>

      <div className="cf-schedule-summary">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
          <span>TODOS</span><strong>{activeCount}</strong>
        </button>
        <button type="button" className={filter === "instagram" ? "active" : ""} onClick={() => setFilter("instagram")}>
          <span>INSTAGRAM</span><strong>{instagramCount}</strong>
        </button>
        <button type="button" className={filter === "youtube" ? "active" : ""} onClick={() => setFilter("youtube")}>
          <span>YOUTUBE</span><strong>{youtubeCount}</strong>
        </button>
      </div>

      <div className="cf-schedules-toolbar">
        <div className="cf-schedule-filter-label">
          <span>PUBLICAÇÕES PROGRAMADAS</span>
          <strong>{visible.length} {visible.length === 1 ? "item" : "itens"}</strong>
        </div>
        <button type="button" className="cf-schedule-refresh" onClick={() => void loadSchedules()} disabled={loading}>
          <span>{loading ? "Atualizando…" : "Atualizar"}</span>
          <b>↻</b>
        </button>
      </div>

      {error && <div className="cf-schedule-alert">{error}</div>}

      {loading ? (
        <div className="cf-schedule-empty"><strong>Carregando agendamentos…</strong><span>Buscando suas publicações programadas.</span></div>
      ) : visible.length === 0 ? (
        <div className="cf-schedule-empty">
          <div className="cf-schedule-empty-icon">◷</div>
          <strong>{filter === "all" ? "Nenhum agendamento encontrado" : `Nenhum agendamento no ${filter === "instagram" ? "Instagram" : "YouTube"}`}</strong>
          <span>Quando você programar uma publicação, ela aparecerá aqui.</span>
        </div>
      ) : (
        <div className="cf-schedule-list">
          {visible.map((item) => {
            const date = new Date(item.scheduledAt);
            const platformLabel = item.platform === "instagram" ? "Instagram Reel" : "YouTube";
            const statusLabel = item.status === "scheduled" ? "Agendado" : item.status === "processing" ? "Publicando" : item.status === "published" ? "Publicado" : item.status === "failed" ? "Falhou" : "Cancelado";
            const dateLabel = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
            const timeLabel = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
            return (
              <article className="cf-schedule-row" key={`${item.platform}-${item.id}`}>
                <div className={`cf-schedule-platform ${item.platform}`}>
                  <span>{item.platform === "instagram" ? "IG" : "YT"}</span>
                </div>
                <div className="cf-schedule-main">
                  <div className="cf-schedule-title">
                    <strong>{item.title}</strong>
                    <span>{platformLabel} · {item.file.replace(".mp4", "").toUpperCase()}</span>
                    {item.lastError && item.status === "failed" && <small>{item.lastError}</small>}
                  </div>
                  <div className="cf-schedule-date">
                    <strong>{dateLabel}</strong>
                    <span>{timeLabel}</span>
                  </div>
                  <span className={`cf-schedule-status ${item.status}`}>{statusLabel}</span>
                  {item.status === "scheduled" ? (
                    <button type="button" className="cf-schedule-cancel" onClick={() => void cancel(item)} disabled={canceling === item.id}>
                      {canceling === item.id ? "Cancelando…" : "Cancelar"}
                    </button>
                  ) : item.platform === "youtube" && item.videoId ? (
                    <a className="cf-schedule-open" href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`} target="_blank" rel="noreferrer">
                      Abrir vídeo ↗
                    </a>
                  ) : <span className="cf-schedule-history">Histórico</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
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
  const [workerOnline, setWorkerOnline] = useState(true);
  const healthFailures = useRef(0);
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
  const [authModal, setAuthModal] = useState("");
  const [publishingTarget, setPublishingTarget] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState("");
  const [publishStatuses, setPublishStatuses] = useState<Record<string, { platform: "youtube" | "instagram"; status: "queued" | "running" | "success" | "failed" | "canceled"; message: string; scheduledPostId?: string }>>({});
  const publishTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [publishDrafts, setPublishDrafts] = useState<Record<string, { title: string; description: string; publishAt: string; instagramPublishAt: string }>>({});
  const [previewClip, setPreviewClip] = useState<{ file: string; url: string; index: number; currentTime: number } | null>(null);
  const [previewErrors, setPreviewErrors] = useState<Record<string, boolean>>({});
  const [activeView, setActiveView] = useState<"generator" | "schedules">("generator");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const emptyResultRetries = useRef(0);
  const canceledJobId = useRef("");
  const pollStartedAt = useRef(0);
  const pollInFlight = useRef(false);
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
    if (stage === "canceled") return "Cancelado";
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
    canceledJobId.current = "";
    setRetrying(true);
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, accessToken: jobAccessToken || undefined }),
      });
      const data = await readJsonResponse<{ error?: string; message?: string; scheduledPost?: { id?: string } }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível tentar novamente.");
      pollStartedAt.current = Date.now();
      setJob({
        status: "processing",
        progress: 5,
        stage: "queued",
        message: data.message || "Nova tentativa iniciada.",
      });
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => poll(jobId, jobAccessToken), 5000);
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : "Não foi possível tentar novamente.");
    } finally {
      setRetrying(false);
    }
  }

  function startNewGeneration() {
    canceledJobId.current = "";
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && jobId && submitting && canceledJobId.current !== jobId) {
        void poll(jobId, jobAccessToken);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleVisibilityChange);
      if (timer.current) clearInterval(timer.current);
      if (publishTimer.current) clearInterval(publishTimer.current);
    };
  }, [jobId, jobAccessToken, submitting]);

  useEffect(() => {
    setVideoInfo(null);
    if (!url.trim()) return;
    const timeout = setTimeout(async () => {
      try {
        setLoadingInfo(true);
        const response = await fetch("/api/youtube-info?url=" + encodeURIComponent(url.trim()), { cache: "no-store" });
        if (!response.ok) return;
        const data = await readJsonResponse<{ title?: string; author?: string; thumbnail?: string }>(response);
        if (data.title && data.thumbnail) {
          setVideoInfo({ title: data.title, author: data.author || "", thumbnail: data.thumbnail });
        }
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
      if (params.get("auth_error") === "session_required") setAuthModal("Entre no Clip Factory para conectar YouTube ou Instagram.");
      else if (params.get("auth_error")) setAuthModal("Não foi possível concluir a autenticação. Tente novamente.");
      if (params.get("youtube_connected") === "1") setAuthModal("YouTube conectado com sucesso.");
      if (params.get("instagram_connected") === "1") setAuthModal("Instagram conectado com sucesso.");
      if (params.get("instagram_error")) setAuthModal("Não foi possível conectar o Instagram. Verifique a configuração e tente novamente.");
      if (["auth_error", "youtube_connected", "instagram_connected", "instagram_error"].some((key) => params.has(key))) {
        window.history.replaceState({}, "", window.location.pathname);
      }
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
      setAuthModal("Autenticação ainda não está configurada.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      setUser(null);
      setActiveView("generator");
      setYoutubeConnected(false);
      setInstagramConnected(false);
    } catch {
      setAuthModal("Não foi possível sair.");
    }
  }

  async function checkInstagram() {
    try {
      const response = await fetch("/api/instagram/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJsonResponse<{ connected?: boolean }>(response);
      setInstagramConnected(Boolean(data.connected));
    } catch {
      setInstagramConnected(false);
    }
  }

  async function checkYouTube() {
    try {
      const response = await fetch("/api/youtube/status", { cache: "no-store" });
      if (!response.ok) return;
      const data = await readJsonResponse<{ connected?: boolean }>(response);
      setYoutubeConnected(Boolean(data.connected));
    } catch {
      setYoutubeConnected(false);
    }
  }

  async function disconnectYouTube() {
    if (!window.confirm("O YouTube já está conectado. Deseja desconectar esta conta?")) return;
    try {
      const response = await fetch("/api/youtube/disconnect", { method: "POST" });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível desconectar o YouTube.");
      setYoutubeConnected(false);
      setAuthModal("YouTube desconectado.");
    } catch (err) {
      setAuthModal(err instanceof Error ? err.message : "Não foi possível desconectar o YouTube.");
    }
  }

  async function disconnectInstagram() {
    if (!window.confirm("O Instagram já está conectado. Deseja desconectar esta conta?")) return;
    try {
      const response = await fetch("/api/instagram/disconnect", { method: "POST" });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível desconectar o Instagram.");
      setInstagramConnected(false);
      setAuthModal("Instagram desconectado.");
    } catch (err) {
      setAuthModal(err instanceof Error ? err.message : "Não foi possível desconectar o Instagram.");
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
      instagramPublishAt: "",
    };
  }

  function updatePublishDraft(file: string, index: number, field: "title" | "description" | "publishAt" | "instagramPublishAt", value: string) {
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
    const setStatus = (status: "queued" | "running" | "success" | "failed" | "canceled", message: string, scheduledPostId?: string) =>
      setPublishStatuses((previous) => ({ ...previous, [file]: { platform: "youtube", status, message, ...(scheduledPostId ? { scheduledPostId } : {}) } }));
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
          accessToken: jobAccessToken || undefined,
        }),
      });
      const data = await readJsonResponse<{ error?: string; runId?: number; startedAt?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar a publicação no YouTube.");
      setStatus("queued", draft.publishAt ? "Publicação agendada no YouTube. Aguardando o envio." : "O vídeo está sendo enviado para o YouTube.");
      const check = async () => {
        try {
          const statusQuery = new URLSearchParams({
            platform: "youtube",
            jobId,
            file,
            ...(data.runId ? { runId: String(data.runId) } : {}),
            ...(data.startedAt ? { startedAt: String(data.startedAt) } : {}),
            ...(jobAccessToken ? { accessToken: jobAccessToken } : {}),
          });
          const statusResponse = await fetch(`/api/publish/status?${statusQuery.toString()}`, { cache: "no-store" });
          const statusData = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(statusData.error || "Não foi possível consultar a publicação.");
          if (statusData.status === "success") {
            setStatus("success", draft.publishAt ? "Publicação agendada com sucesso no YouTube." : "Vídeo publicado com sucesso no YouTube.", statusData.scheduledPostId);
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
            setStatus(statusData.status === "running" ? "running" : "queued", statusData.message || "O vídeo está sendo enviado para o YouTube.");
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
    const scheduledAt = draft.instagramPublishAt ? new Date(draft.instagramPublishAt).toISOString() : "";
    try {
      const endpoint = scheduledAt ? "/api/instagram/schedule" : "/api/instagram/publish";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          scheduledAt
            ? { jobId, file, caption, scheduledAt, accessToken: jobAccessToken || undefined }
            : { jobId, file, caption, accessToken: jobAccessToken || undefined },
        ),
      });
      const data = await readJsonResponse<{ error?: string; message?: string; scheduledPost?: { id?: string } }>(response);
      if (!response.ok) throw new Error(data.error || (scheduledAt ? "Não foi possível agendar o Reel no Instagram." : "Não foi possível publicar no Instagram."));
      setPublishStatuses((previous) => ({
        ...previous,
        [file]: {
          platform: "instagram",
          status: "success",
          message: scheduledAt
            ? `Reel agendado para ${new Date(scheduledAt).toLocaleString("pt-BR")}.`
            : (data.message || "Reel publicado com sucesso no Instagram."),
          ...(scheduledAt && data.scheduledPost?.id ? { scheduledPostId: data.scheduledPost.id } : {}),
        },
      }));
    } catch (err) {
      setPublishStatuses((previous) => ({ ...previous, [file]: { platform: "instagram", status: "failed", message: err instanceof Error ? err.message : "Erro ao publicar no Instagram." } }));
    } finally {
      setPublishingTarget(null);
    }
  }
  async function cancelInstagramSchedule(file: string, scheduledPostId: string) {
    if (!window.confirm("Deseja cancelar este agendamento do Instagram?")) return;
    try {
      const response = await fetch(`/api/instagram/schedule?id=${encodeURIComponent(scheduledPostId)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível cancelar o agendamento do Instagram.");
      setPublishStatuses((previous) => ({
        ...previous,
        [file]: {
          ...previous[file],
          status: "canceled",
          message: "Agendamento do Instagram cancelado.",
          scheduledPostId: undefined,
        },
      }));
    } catch (err) {
      setPublishStatuses((previous) => ({
        ...previous,
        [file]: {
          ...previous[file],
          status: "failed",
          message: err instanceof Error ? err.message : "Não foi possível cancelar o agendamento do Instagram.",
        },
      }));
    }
  }

  async function cancelYouTubeSchedule(file: string, scheduledPostId: string) {
    if (!window.confirm("Deseja cancelar este agendamento do YouTube?")) return;
    try {
      const response = await fetch(`/api/youtube/schedule?id=${encodeURIComponent(scheduledPostId)}`, { method: "DELETE" });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível cancelar o agendamento do YouTube.");
      setPublishStatuses((previous) => ({
        ...previous,
        [file]: {
          ...previous[file],
          status: "canceled",
          message: "Agendamento do YouTube cancelado. O vídeo permanece privado.",
          scheduledPostId: undefined,
        },
      }));
    } catch (err) {
      setPublishStatuses((previous) => ({
        ...previous,
        [file]: {
          ...previous[file],
          status: "failed",
          message: err instanceof Error ? err.message : "Não foi possível cancelar o agendamento do YouTube.",
        },
      }));
    }
  }

  async function checkWorker() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (response.ok) {
        healthFailures.current = 0;
        setWorkerOnline(true);
        return;
      }
      healthFailures.current += 1;
      if (healthFailures.current >= 3) setWorkerOnline(false);
    } catch {
      healthFailures.current += 1;
      if (healthFailures.current >= 3) setWorkerOnline(false);
    }
  }

  async function poll(id: string, accessTokenOverride?: string) {
    if (canceledJobId.current === id || pollInFlight.current) return;
    pollInFlight.current = true;
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
      let sessionAccessToken = accessTokenOverride || jobAccessToken;
      if (!sessionAccessToken && !GENERATION_ONLY_MODE) {
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          sessionAccessToken = data.session?.access_token || "";
        } catch {
          sessionAccessToken = "";
        }
      }
      const response = await fetch("/api/jobs?" + query.toString(), {
        cache: "no-store",
        headers: sessionAccessToken ? { Authorization: `Bearer ${sessionAccessToken}` } : undefined,
      });
      if (!response.ok) throw new Error("Não foi possível consultar o processamento.");
      const data = await readJsonResponse<Job>(response);
      if (canceledJobId.current === id) return;
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
      // Mobile browsers can suspend network requests while the tab is in the
      // background. Keep polling and avoid turning a transient wake-up/network
      // failure into a persistent user-facing error.
      if (document.visibilityState === "visible" && navigator.onLine !== false) {
        console.warn("Clip job polling temporarily unavailable:", err);
      }
    } finally {
      pollInFlight.current = false;
    }
  }

  function getDownloadUrl(file: string) {
    const params = new URLSearchParams({ jobId, file });
    if (jobAccessToken) params.set("accessToken", jobAccessToken);
    return `/api/jobs/download?${params.toString()}`;
  }

  async function downloadClip(file: string) {
    try {
      const response = await fetch(getDownloadUrl(file), { cache: "no-store" });
      if (!response.ok) {
        const data = await readJsonResponse<{ error?: string }>(response).catch(() => null);
        throw new Error(data?.error || "Não foi possível baixar o clip.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = file;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar o clip.");
    }
  }

  async function downloadAllClips() {
    if (!jobId || !job?.result?.files?.length) return;
    try {
      const params = new URLSearchParams({ jobId });
      if (jobAccessToken) params.set("accessToken", jobAccessToken);
      const response = await fetch(`/api/jobs/download-all?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const data = await readJsonResponse<{ error?: string }>(response).catch(() => null);
        throw new Error(data?.error || "Não foi possível gerar o ZIP dos clips.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `clip-factory-${jobId.slice(0, 8)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível baixar os clips.");
    }
  }

  async function cancelJob() {
    if (!jobId || !submitting) return;
    setError("");
    try {
      const response = await fetch("/api/jobs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, accessToken: jobAccessToken || undefined }),
      });
      const data = await readJsonResponse<{ error?: string; message?: string }>(response);
      if (!response.ok) throw new Error(data.error || "Não foi possível cancelar o processamento.");
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      canceledJobId.current = jobId;
      setSubmitting(false);
      setJob((previous) => previous ? { ...previous, status: "canceled", stage: "canceled", progress: previous.progress, message: data.message || "Processamento cancelado." } : previous);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cancelar o processamento.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    canceledJobId.current = "";
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
      const data = await readJsonResponse<{ error?: string; githubStatus?: number; jobId?: string; accessToken?: string } & Partial<Job>>(response);
      if (!response.ok) {
        const detail = data.githubStatus ? ` (GitHub HTTP ${data.githubStatus})` : "";
        throw new Error(`${data.error || "Não foi possível iniciar o processamento."}${detail}`);
      }
      if (!data.jobId) {
        throw new Error("O servidor criou o processamento, mas não retornou o identificador do job.");
      }
      setWorkerOnline(true);
      setJobId(data.jobId);
      setJobAccessToken(data.accessToken || "");
      pollStartedAt.current = Date.now();
      setJob({
        status: data.status || "processing",
        progress: typeof data.progress === "number" ? data.progress : 0,
        stage: data.stage,
        message: data.message || "Processamento iniciado.",
        error: data.error,
        result: data.result,
      });
      timer.current = setInterval(() => poll(data.jobId!, data.accessToken || ""), 5000);
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
            <span className="cf-live-label">AI CLIP MAKER</span>
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
                  {youtubeConnected ? (
                    <button type="button" className="cf-youtube-button" onClick={disconnectYouTube} aria-label="Desconectar YouTube">
                      <span className="cf-yt-dot connected" />
                      YouTube conectado
                    </button>
                  ) : (
                    <a className="cf-youtube-button" href="/api/youtube/oauth" aria-label="Conectar YouTube">
                      <span className="cf-yt-dot" />
                      Conectar YouTube
                    </a>
                  )}
                  {instagramConnected ? (
                    <button type="button" className="cf-youtube-button" onClick={disconnectInstagram} aria-label="Desconectar Instagram">
                      <span className="cf-yt-dot connected" />
                      Instagram conectado
                    </button>
                  ) : (
                    <a className="cf-youtube-button" href="/api/instagram/oauth" aria-label="Conectar Instagram">
                      <span className="cf-yt-dot" />
                      Conectar Instagram
                    </a>
                  )}
                  <span className="cf-account-label" title={user.email || "Conta do Clip Factory"}>Clip Factory conectado</span>
                  <button type="button" className="cf-auth-button" onClick={signOut}>Sair</button>
                </>
              )}
            </>}
            <div className={`cf-status-pill ${workerOnline ? "online" : "offline"}`}><span /> {workerOnline ? "Sistema online" : "Sistema indisponível"}</div>
          </div>
        </header>

        {!GENERATION_ONLY_MODE && user && (
          <nav className="cf-main-nav" aria-label="Navegação principal">
            <button type="button" className={activeView === "generator" ? "active" : ""} onClick={() => setActiveView("generator")}>
              <span>01</span> Gerar clips
            </button>
            <button type="button" className={activeView === "schedules" ? "active" : ""} onClick={() => setActiveView("schedules")}>
              <span>02</span> Agendamentos
            </button>
          </nav>
        )}

        {(!user || activeView === "generator" || GENERATION_ONLY_MODE) ? (
          <>
        <section className="cf-hero">
          <div className="cf-hero-copy">
            <div className="cf-hero-label"><span /> AI CLIP MAKER</div>
            <h2>Transforme vídeos<br /><em>em clips.</em></h2>
            <p>Escolha o vídeo, defina o formato e deixe o Clip Factory encontrar os melhores momentos automaticamente.</p>
            <div className="cf-hero-pills"><span>9:16</span><span>LEGENDAS</span><span>PRONTO PARA PUBLICAR</span></div>
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

          {videoInfo && (
            <div className="cf-video-info">
              <div className="cf-video-thumb-wrap"><img src={videoInfo.thumbnail} alt="" /><span>9:16</span></div>
              <div><strong>{videoInfo.title}</strong><span>{videoInfo.author}</span><small className="cf-video-ready">● VÍDEO IDENTIFICADO</small></div>
              <span className="cf-video-check">✓</span>
            </div>
          )}

          <div className="cf-cut-panel">
            <div className="cf-builder-head cf-section-head cf-cut-head">
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
          </div>

          <div className="cf-builder-head cf-section-head">
            <div><span className="cf-kicker">03 / STYLE</span><h3>Escolha o estilo da legenda</h3></div>
            <span className="cf-section-note">Preview fiel ao preset usado na renderização</span>
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
            <div><span>PRESET SELECIONADO</span><strong>{selectedTemplate[1]}</strong><p>{selectedTemplate[2]} · mesma tipografia, destaque e posicionamento do vídeo final · 9:16</p></div>
            <div className="cf-style-wave"><i/><i/><i/><i/><i/><i/></div>
          </div>

          <div className="cf-actions">
            <button className="cf-button" type="submit" disabled={submitting}>
              <span>{submitting ? "PROCESSANDO..." : "GERAR CLIPS"}</span><b>↗</b>
            </button>
            {submitting && (
              <button type="button" className="cf-cancel-button" onClick={cancelJob}>
                CANCELAR PROCESSAMENTO
              </button>
            )}
          </div>

          {jobId && job && (
            <div className="cf-job">
              <div className="cf-job-top"><div><span className="cf-job-live">{job.status === "canceled" ? "PROCESSAMENTO CANCELADO" : job.status === "failed" ? "PROCESSAMENTO INTERROMPIDO" : "PROCESSAMENTO AO VIVO"}</span><strong>{job.status === "canceled" ? "Cancelado" : job.progress >= 100 ? "Concluído" : getProgressStage(job.progress, job.stage)}</strong></div><span className="cf-job-percent">{job.status === "canceled" ? "CANCELADO" : `${job.progress}%`}</span></div>
              <div className={`cf-progress ${job.status === "canceled" ? "canceled" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label={job.status === "canceled" ? "Processamento cancelado" : "Progresso da geração"}><div style={{ width: `${job.progress}%` }} /></div>
              <div className="cf-job-steps">
                {[[10, "DOWNLOAD"], [25, "TRANSCRIÇÃO"], [45, "MOMENTOS"], [60, "TRADUÇÃO"], [78, "RENDER"], [100, "PRONTO"]].map(([threshold, label]) => <span key={label} className={job.progress >= Number(threshold) ? "done" : ""}>{label}</span>)}
              </div>
              <small>{job.status === "canceled" ? "Processamento cancelado" : job.status === "failed" ? "Processamento interrompido. Os clips já gerados foram preservados." : getProgressStage(job.progress, job.stage)}{job.result?.files?.length ? ` · ${job.result.files.length} clip${job.result.files.length === 1 ? "" : "s"} já disponível${job.result.files.length === 1 ? "" : "eis"}` : ""}{job.status !== "completed" && job.message && !/install system dependencies|install dependencies|github actions|r2|job [a-f0-9-]{8,}/i.test(job.message) ? ` · ${job.message}` : ""}</small>
            </div>
          )}

          {error && <p className="cf-error">{error}</p>}
          {job?.status === "canceled" && (
            <div className="cf-job-canceled">
              <strong>PROCESSAMENTO CANCELADO</strong>
              <span>O processamento foi interrompido. Você pode alterar as opções e iniciar uma nova geração.</span>
            </div>
          )}

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

        {Boolean(job?.result?.files?.length) && (
          <section className="cf-results">
            <div className="cf-results-head">
              <div className="cf-results-title">
                <div className="cf-section-kicker">04 / OUTPUT</div>
                <h2>{job?.status === "completed" ? "Seus clips estão prontos." : "Clips disponíveis."}</h2>
                <p><strong>{job?.result?.files?.length ?? 0} de {clips} clips disponíveis</strong> · 9:16 · prontos para baixar ou publicar.</p>
                {(job?.result?.files?.length ?? 0) < Number(clips) && (
                  <div className="cf-partial-output">
                    <strong>{job?.status === "completed" ? "Resultado parcial disponível" : "Clips preservados apesar da falha"}</strong>
                    <span>Os arquivos disponíveis já podem ser baixados ou publicados. Você pode tentar novamente para gerar os clips restantes.</span>
                  </div>
                )}
              </div>
              <div className="cf-results-head-actions">
                <div className="cf-output-badge"><span /> {job?.result?.files?.length ?? 0}/{clips} DISPONÍVEIS</div>
                <button type="button" className="cf-button cf-button-secondary" onClick={downloadAllClips} disabled={!job?.result?.files?.length}>Baixar tudo <b>↓</b></button>
                <button type="button" className="cf-results-new" onClick={startNewGeneration}>+ Novo vídeo</button>
              </div>
            </div>
            <div className="cf-results-grid">
              {(job?.result?.files ?? []).map((r2File, index) => {
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
                        <span>{duration === "15-30" ? "15–30s" : duration === "45-90" ? "45–90s" : "30–60s"} · 9:16 · SHORT</span><small>Arquivo final · MP4</small>
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
                                disabled={publishingTarget === `youtube:${file}`}
                              />
                              <small>Preencha data e horário e clique em “Agendar YouTube”. Deixe em branco para publicar imediatamente.</small>
                            </label>
                          )}
                          {!GENERATION_ONLY_MODE && instagramConnected && (
                            <label>
                              <span>Agendar publicação no Instagram</span>
                              <input
                                type="datetime-local"
                                value={getPublishDraft(file, index).instagramPublishAt}
                                onChange={(e) => updatePublishDraft(file, index, "instagramPublishAt", e.target.value)}
                                disabled={publishingTarget === `instagram:${file}`}
                              />
                              <small>Preencha data e horário e clique em “Agendar Instagram”. Deixe em branco para publicar imediatamente.</small>
                            </label>
                          )}
                        </div>
                      )}
                      {publishStatuses[file] && (
                        <>
                          <div className={`cf-publish-status cf-publish-status-${publishStatuses[file].status}`}>
                            <strong>{publishStatuses[file].status === "success" ? "✓" : publishStatuses[file].status === "failed" ? "!" : publishStatuses[file].status === "canceled" ? "×" : "⋯"}</strong>
                            <span>{publishStatuses[file].message}</span>
                          </div>
                          {publishStatuses[file].scheduledPostId && publishStatuses[file].status === "success" && (
                            <button
                              type="button"
                              className="cf-schedule-cancel"
                              onClick={() =>
                                publishStatuses[file].platform === "instagram"
                                  ? cancelInstagramSchedule(file, publishStatuses[file].scheduledPostId!)
                                  : cancelYouTubeSchedule(file, publishStatuses[file].scheduledPostId!)
                              }
                            >
                              Cancelar agendamento
                            </button>
                          )}
                        </>
                      )}
                      <div className="cf-result-actions">
                        <button type="button" className="cf-download cf-download-button" onClick={() => downloadClip(file)}>Baixar <span>↓</span></button>
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
                            disabled={publishingTarget === `instagram:${file}` || publishingTarget === `youtube:${file}` || !getPublishDraft(file, index).title.trim()}
                          >
                            {publishingTarget === `instagram:${file}`
                              ? (getPublishDraft(file, index).instagramPublishAt ? "Agendando…" : "Publicando…")
                              : (getPublishDraft(file, index).instagramPublishAt ? "Agendar Instagram ↗" : "Publicar Instagram ↗")}
                          </button>
                        )}
                      </div>                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
        </>
        ) : (
          <ScheduleScreen />
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
              <button type="button" className="cf-download cf-download-button" onClick={() => downloadClip(previewClip.file)}>Baixar <span>↓</span></button>
              <button type="button" className="cf-preview-close-action" onClick={() => setPreviewClip(null)}>Fechar preview</button>
            </div>
          </div>
        </div>
      )}

      {!GENERATION_ONLY_MODE && authModal && (
        <div className="cf-auth-modal" role="dialog" aria-modal="true" aria-label="Status da conexão" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthModal(""); }}>
          <div className="cf-auth-modal-card">
            <div className="cf-auth-modal-icon">✓</div>
            <div className="cf-auth-modal-copy">
              <span>CLIP FACTORY</span>
              <strong>{authModal}</strong>
            </div>
            <button type="button" className="cf-auth-modal-close" onClick={() => setAuthModal("")} aria-label="Fechar mensagem">×</button>
            <button type="button" className="cf-auth-modal-action" onClick={() => setAuthModal("")}>Continuar</button>
          </div>
        </div>
      )}
    </main>
  );
}
