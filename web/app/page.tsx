"use client";

import { FormEvent, useState } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState("openai");
  const [clips, setClips] = useState("5");
  const [status, setStatus] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setStatus("A interface está pronta. Na próxima etapa o worker será conectado para processar o vídeo.");
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
          <p className="cf-status">{status}</p>
        </form>

        <section className="cf-roadmap">
          <div className="cf-step"><strong>01 · Analisar</strong><span>yt-dlp + Whisper geram transcrição com timestamps e a IA seleciona os trechos.</span></div>
          <div className="cf-step"><strong>02 · Renderizar</strong><span>FFmpeg cria vídeos 9:16, legendas e enquadramento vertical.</span></div>
          <div className="cf-step"><strong>03 · Publicar</strong><span>Fase futura: fila, calendário e publicação automática em YouTube Shorts e Instagram.</span></div>
        </section>
      </div>
    </main>
  );
}
