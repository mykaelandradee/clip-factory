"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Job = {
  status: string;
  progress: number;
  stage?: string;
  message: string;
  error?: string;
  result?: { downloadUrl?: string };
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [clips, setClips] = useState("5");
  const [duration, setDuration] = useState("30-60");
  const [subtitleLanguage, setSubtitleLanguage] = useState("original");
  const [captionStyle, setCaptionStyle] = useState("dynamic");
  const [workerOnline, setWorkerOnline] = useState(false);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkWorker();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  async function checkWorker() {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setWorkerOnline(response.ok);
    } catch { setWorkerOnline(false); }
  }

  async function poll(id: string) {
    try {
      const response = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível consultar o processamento.");
      const data = await response.json() as Job;
      setJob(data);
      setWorkerOnline(true);
      if (data.status === "completed" || data.status === "failed") {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao consultar o processamento.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setJob(null);
    setJobId("");
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
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar o processamento.");
      setWorkerOnline(true);
      setJobId(data.jobId);
      setJob(data);
      timer.current = setInterval(() => poll(data.jobId), 3000);
    } catch (err) {
      setSubmitting(false);
      setWorkerOnline(false);
      setError(err instanceof Error ? err.message : "Não foi possível iniciar o processamento.");
    }
  }

  return (
    <main className="cf-shell">
      <div className="cf-container">
        <header className="cf-header cf-header-modern">
          <div className="cf-brand"><div className="cf-logo">CF</div><span>Clip Factory</span></div>
          <div className={`cf-status-pill ${workerOnline ? "online" : "offline"}`}><span /> GitHub Actions {workerOnline ? "conectado" : "não configurado"}</div>
        </header>

        <section className="cf-hero"><div><div className="cf-hero-label">VIDEO → CLIPS</div><h2>Transforme seu vídeo<br /><em>em conteúdo.</em></h2></div><div className="cf-hero-mark">9:16</div></section>

        <form className="cf-card cf-builder" onSubmit={submit}>
          <div className="cf-grid">
            <div className="cf-field">
              <label htmlFor="url">URL do YouTube</label>
              <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." disabled={submitting} />
            </div>
            <div className="cf-field">
              <label htmlFor="clips">Quantidade</label>
              <select id="clips" value={clips} onChange={(e) => setClips(e.target.value)} disabled={submitting}>
                <option>3</option><option>5</option><option>10</option><option>15</option>
              </select>
            </div>
            <div className="cf-field">
              <label htmlFor="subtitle-language">Idioma da legenda</label>
              <select id="subtitle-language" value={subtitleLanguage} onChange={(e) => setSubtitleLanguage(e.target.value)} disabled={submitting}>
                <option value="original">Idioma original</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en">English</option>
              </select>
              <small>Português (Brasil) traduz a fala para PT-BR usando modelos locais.</small>
            </div>
            
          </div>

          <div className="cf-label-row cf-section-gap"><span>Duração do clip</span><small>Defina o tamanho dos cortes</small></div>
          <div className="cf-duration-grid">
            {[["15-30", "15–30s"], ["30-60", "30–60s"], ["45-90", "45–90s"]].map(([id, label]) => (
              <button type="button" key={id} className={`cf-duration ${duration === id ? "selected" : ""}`} onClick={() => setDuration(id)} disabled={submitting}>
                <strong>{label}</strong><span>Clips entre essa duração</span>
              </button>
            ))}
          </div>

          <div className="cf-label-row"><span>Templates</span><small>Escolha um estilo</small></div>
          <div className="cf-template-grid">{["dynamic","clean","bold","highlight","neon","minimal"].map((id) => <button type="button" key={id} className={`cf-template ${captionStyle===id ? "selected":""} ${["highlight","neon","minimal"].includes(id) ? "coming":""}`} onClick={() => !["highlight","neon","minimal"].includes(id) && setCaptionStyle(id)} disabled={submitting || ["highlight","neon","minimal"].includes(id)}><div className={`cf-template-preview accent-${id}`}><span className="preview-top">A</span><span className="preview-subtitle">{id==="bold"?"ISSO MUDA TUDO":id==="dynamic"?"isso MUDA tudo":"isso muda tudo"}</span></div><div className="cf-template-info"><strong>{id[0].toUpperCase()+id.slice(1)}</strong><span>{id==="dynamic"?"Destaque palavra por palavra":id==="clean"?"Discreta e elegante":id==="bold"?"Grande e marcante":id==="highlight"?"Palavra em destaque":id==="neon"?"Visual forte e moderno":"Pequena e sofisticada"}</span></div>{["highlight","neon","minimal"].includes(id) ? <span className="cf-coming">Em breve</span> : captionStyle===id ? <span className="cf-check">✓</span> : null}</button>)}</div>

          <div className="cf-actions">
            <button className="cf-button" type="submit" disabled={submitting}>{submitting ? "Processando..." : "Analisar vídeo"}</button>
          </div>

          {jobId && job && (
            <div className="cf-job">
              <div className="cf-job-top"><strong>{job.message}</strong><span>{job.progress}%</span></div>
              <div className="cf-progress"><div style={{ width: `${job.progress}%` }} /></div>
              <small>Job {jobId}{job.stage ? ` · ${job.stage}` : ""}</small>
            </div>
          )}

          {error && <p className="cf-error">{error}</p>}
          {job?.status === "failed" && <p className="cf-error">{job.error || job.message}</p>}
        </form>

        {job?.status === "completed" && job.result && (
          <section className="cf-results">
            <div className="cf-results-head">
              <div><div className="cf-section-kicker">Resultado</div><h2>Seus clips estão prontos.</h2></div>
              <a className="cf-button cf-button-secondary" href={job.result.downloadUrl} download>Baixar tudo</a>
            </div>
            <div className="cf-results-grid">
              {Array.from({ length: Number(clips) }, (_, index) => {
                const file = `clip-${String(index + 1).padStart(2, "0")}.mp4`;
                const source = `/api/jobs/file?id=${encodeURIComponent(jobId)}&file=${encodeURIComponent(file)}&preview=1`;
                const download = `/api/jobs/file?id=${encodeURIComponent(jobId)}&file=${encodeURIComponent(file)}`;
                return (
                  <article className="cf-result-card" key={file}>
                    <div className="cf-video-wrap">
                      <video controls preload="metadata" src={source} />
                      <span className="cf-clip-number">0{index + 1}</span>
                    </div>
                    <div className="cf-result-info">
                      <div><strong>Clip {index + 1}</strong><span>{duration === "15-30" ? "15–30s" : duration === "45-90" ? "45–90s" : "30–60s"}</span></div>
                      <a href={download} download className="cf-download">Baixar <span>↓</span></a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
