"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Job = {
  status: string;
  progress: number;
  stage?: string;
  message: string;
  error?: string;
  result?: {
    files: Array<{ name: string; url: string }>;
    candidates: Array<unknown>;
    downloadUrl?: string;
  };
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [clips, setClips] = useState("5");
  const [subtitleLanguage, setSubtitleLanguage] = useState("original");
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
    } catch {
      setWorkerOnline(false);
    }
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
          min_duration: 20,
          max_duration: 60,
          subtitle_language: subtitleLanguage,
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
        <header className="cf-header">
          <div>
            <div className="cf-kicker">AI video pipeline</div>
            <h1>Clip Factory</h1>
            <p className="cf-subtitle">Cole um vídeo longo e deixe o Clip Factory encontrar os melhores momentos usando processamento local no GitHub Actions.</p>
          </div>
          <div className={`cf-status-pill ${workerOnline ? "online" : "offline"}`}>
            <span /> GitHub Actions {workerOnline ? "conectado" : "não configurado"}
          </div>
        </header>

        <form className="cf-card" onSubmit={submit}>
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
                <option value="original">Português / idioma original</option>
                <option value="en">English</option>
              </select>
              <small>O modo English traduz a fala para inglês usando o Whisper local.</small>
            </div>
          </div>
          <div className="cf-actions">
            <button className="cf-button" type="submit" disabled={submitting}>
              {submitting ? "Processando..." : "Analisar vídeo"}
            </button>
          </div>

          {jobId && job && <div className="cf-job">
            <div className="cf-job-top"><strong>{job.message}</strong><span>{job.progress}%</span></div>
            <div className="cf-progress"><div style={{ width: `${job.progress}%` }} /></div>
            <small>Job {jobId}{job.stage ? ` · ${job.stage}` : ""}</small>
          </div>}

          {error && <p className="cf-error">{error}</p>}
          {job?.status === "failed" && <p className="cf-error">{job.error || job.message}</p>}
        </form>

        {job?.status === "completed" && job.result && (
          <section className="cf-results">
            <div className="cf-results-head">
              <h2>Processamento concluído</h2>
              <span>resultado disponível</span>
            </div>
            <div className="cf-card">
              <p>Os clips e o resultado foram gerados pelo GitHub Actions.</p>
              <a className="cf-button" href={job.result.downloadUrl} target="_blank" rel="noreferrer">
                Baixar clips
              </a>
            </div>
          </section>
        )}

        <section className="cf-roadmap">
          <div className="cf-step"><strong>01 · Analisar</strong><span>yt-dlp + Whisper executam no runner gratuito do GitHub.</span></div>
          <div className="cf-step"><strong>02 · Selecionar</strong><span>O processamento local identifica os melhores trechos.</span></div>
          <div className="cf-step"><strong>03 · Baixar</strong><span>Os resultados ficam disponíveis como artefato por 3 dias.</span></div>
        </section>
      </div>
    </main>
  );
}
