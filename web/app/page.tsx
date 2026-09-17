"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Job = {
  status: string;
  progress: number;
  stage?: string;
  message: string;
  error?: string;
  result?: {
    candidates: Array<{ title: string; hook: string; reason: string; score: number; start: number; end: number }>;
    files: Array<{ name: string; url: string }>;
  };
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("openai");
  const [clips, setClips] = useState("5");
  const [workerOnline, setWorkerOnline] = useState(false);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao consultar o processamento.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setJob(null);
    if (!url.trim()) return setError("Informe a URL do YouTube.");

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), provider, count: Number(clips), min_duration: 20, max_duration: 60 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar o processamento.");
      setWorkerOnline(true);
      setJobId(data.jobId);
      await poll(data.jobId);
      timer.current = setInterval(() => poll(data.jobId), 2000);
    } catch (err) {
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
            <p className="cf-subtitle">Cole um vídeo longo, deixe a IA encontrar os melhores momentos e transforme-os em shorts verticais prontos para publicar.</p>
          </div>
          <div className={`cf-status-pill ${workerOnline ? "online" : "offline"}`}>
            <span /> Worker {workerOnline ? "online" : "offline"}
          </div>
        </header>

        <form className="cf-card" onSubmit={submit}>
          <div className="cf-grid">
            <div className="cf-field">
              <label htmlFor="url">URL do YouTube</label>
              <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
            </div>
            <div className="cf-field">
              <label htmlFor="provider">IA</label>
              <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="openai">ChatGPT / OpenAI</option>
                <option value="anthropic">Claude / Anthropic</option>
                <option value="ollama">Ollama local</option>
              </select>
            </div>
            <div className="cf-field">
              <label htmlFor="clips">Quantidade</label>
              <select id="clips" value={clips} onChange={(e) => setClips(e.target.value)}>
                <option>3</option><option>5</option><option>10</option><option>15</option>
              </select>
            </div>
          </div>
          <div className="cf-actions"><button className="cf-button" type="submit">Analisar vídeo</button></div>
          {jobId && job && <div className="cf-job">
            <div className="cf-job-top"><strong>{job.message}</strong><span>{job.progress}%</span></div>
            <div className="cf-progress"><div style={{ width: `${job.progress}%` }} /></div>
            <small>Job {jobId}{job.stage ? ` · ${job.stage}` : ""}</small>
          </div>}
          {error && <p className="cf-error">{error}</p>}
          {job?.status === "failed" && <p className="cf-error">{job.error || job.message}</p>}
        </form>

        {job?.status === "completed" && job.result && <section className="cf-results">
          <div className="cf-results-head"><h2>Clips gerados</h2><span>{job.result.files.length} arquivos</span></div>
          <div className="cf-results-grid">
            {job.result.files.map((file, index) => {
              const candidate = job.result!.candidates[index];
              return <article className="cf-result" key={file.url}>
                <video controls preload="metadata" src={file.url} />
                <div className="cf-result-body">
                  <strong>{candidate?.title || file.name}</strong>
                  {candidate?.hook && <p>{candidate.hook}</p>}
                  <a href={file.url} target="_blank" rel="noreferrer">Abrir clip</a>
                </div>
              </article>;
            })}
          </div>
        </section>}

        <section className="cf-roadmap">
          <div className="cf-step"><strong>01 · Analisar</strong><span>yt-dlp + Whisper geram transcrição com timestamps e a IA seleciona os trechos.</span></div>
          <div className="cf-step"><strong>02 · Renderizar</strong><span>FFmpeg cria vídeos 9:16 e aplica o tratamento visual do clip.</span></div>
          <div className="cf-step"><strong>03 · Publicar</strong><span>Fase futura: fila, calendário e publicação automática em YouTube Shorts e Instagram.</span></div>
        </section>
      </div>
    </main>
  );
}
