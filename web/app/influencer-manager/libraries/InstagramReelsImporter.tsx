"use client";

import { useEffect, useMemo, useState } from "react";

type Library = {
  id: string;
  name: string;
  item_count: number;
  profiles: { profile_id: string; profile_name: string; priority: number; enabled: boolean }[];
};

type Reel = {
  id: string;
  shortcode: string;
  url: string;
  thumbnail: string | null;
  title: string;
  caption: string;
  publishedAt: string | null;
  duplicate: boolean;
};

type Props = {
  currentLibraryId?: string;
  onImported?: () => Promise<void> | void;
};

export default function InstagramReelsImporter({ currentLibraryId = "", onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryId, setLibraryId] = useState(currentLibraryId);
  const [url, setUrl] = useState("");
  const [profile, setProfile] = useState<{ username: string; name: string; avatar: string | null; isVerified: boolean } | null>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLibraryId(currentLibraryId || libraryId);
    void loadLibraries();
  }, [open]);

  useEffect(() => {
    if (currentLibraryId) setLibraryId(currentLibraryId);
  }, [currentLibraryId]);

  async function loadLibraries() {
    try {
      const response = await fetch("/api/influencer/libraries", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as bibliotecas.");
      const next = data.libraries || [];
      setLibraries(next);
      setLibraryId(current => current && next.some((item: Library) => item.id === current)
        ? current
        : next[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar as bibliotecas.");
    }
  }

  async function discover() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setMessage("");
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ url: url.trim() });
      if (libraryId) params.set("libraryId", libraryId);
      const response = await fetch("/api/influencer/instagram/reels?" + params.toString(), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível listar os Reels.");
      setProfile(data.profile || null);
      setReels(data.reels || []);
      if (!data.reels?.length) {
        setMessage("Nenhum Reel foi encontrado neste perfil.");
      } else if (data.hasMore) {
        setMessage(`Mostrando ${data.reels.length} Reels encontrados nesta consulta. O Instagram indicou que existem mais itens disponíveis.`);
      }
    } catch (e) {
      setProfile(null);
      setReels([]);
      setError(e instanceof Error ? e.message : "Não foi possível listar os Reels.");
    } finally {
      setLoading(false);
    }
  }

  const available = useMemo(() => reels.filter(reel => !reel.duplicate), [reels]);
  const selectedCount = selected.size;

  function toggleReel(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(current => current.size === available.length
      ? new Set()
      : new Set(available.map(reel => reel.id)));
  }

  async function importSelected() {
    const library = libraries.find(item => item.id === libraryId);
    const processingProfile = library?.profiles.find(profile => profile.enabled);
    if (!library || !processingProfile) {
      setError("Escolha uma biblioteca que tenha pelo menos um perfil vinculado e ativo.");
      return;
    }
    const targets = reels.filter(reel => selected.has(reel.id));
    if (!targets.length) return;

    setImporting(true);
    setError("");
    setMessage("");
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    const importedIds = new Set<string>();

    for (const reel of targets) {
      try {
        const response = await fetch("/api/influencer/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: processingProfile.profile_id,
            libraryId: library.id,
            sourceUrl: reel.url,
            title: reel.title,
          }),
        });
        if (response.ok || response.status === 202) {
          imported += 1;
          importedIds.add(reel.id);
        } else if (response.status === 409) {
          duplicates += 1;
          importedIds.add(reel.id);
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }

    setSelected(new Set());
    setReels(current => current.map(reel => importedIds.has(reel.id)
      ? { ...reel, duplicate: true }
      : reel));
    setImporting(false);
    if (imported && onImported) await onImported();

    const parts = [];
    if (imported) parts.push(`${imported} importado${imported === 1 ? "" : "s"}`);
    if (duplicates) parts.push(`${duplicates} já estava${duplicates === 1 ? "" : "m"} na biblioteca`);
    if (failed) parts.push(`${failed} com erro`);
    setMessage(parts.join(" · ") || "Nenhum Reel foi importado.");
  }

  return <>
    <button className="im-ghost" type="button" onClick={() => { setOpen(true); setError(""); setMessage(""); }}>
      Importar Reels do Instagram
    </button>

    {open && <div className="im-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="importar-reels-title">
      <div className="im-modal im-standard-modal im-instagram-import-modal">
        <div className="im-card-head">
          <div>
            <span className="im-kicker">INSTAGRAM</span>
            <h2 id="importar-reels-title">Importar Reels para uma biblioteca</h2>
            <p>Informe um perfil público, selecione os Reels desejados e escolha onde eles serão processados.</p>
          </div>
          <button className="im-ghost" type="button" disabled={importing} onClick={() => setOpen(false)}>Fechar</button>
        </div>

        <div className="im-modal-form">
          <label>
            Biblioteca de destino
            <select className="im-form-select" value={libraryId} onChange={e => { setLibraryId(e.target.value); setReels([]); setProfile(null); setSelected(new Set()); }}>
              <option value="">Selecione uma biblioteca</option>
              {libraries.map(library => (
                <option key={library.id} value={library.id}>{library.name}</option>
              ))}
            </select>
          </label>

          <div className="im-url-form">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/usuario/"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void discover(); } }}
            />
            <button className="im-primary" type="button" disabled={loading || !url.trim()} onClick={() => void discover()}>
              {loading ? "Buscando…" : "Listar Reels"}
            </button>
          </div>

          {error && <div className="im-error-text">{error}</div>}
          {message && <div className="im-form-note">{message}</div>}
        </div>

        {profile && <div className="im-instagram-profile">
          {profile.avatar ? <img src={profile.avatar} alt="" /> : <span className="im-avatar">{profile.name.slice(0, 1).toUpperCase()}</span>}
          <div><strong>{profile.name}</strong><span>@{profile.username}{profile.isVerified ? " · verificado" : ""}</span></div>
          {reels.length > 0 && <strong className="im-count">{reels.length} Reels</strong>}
        </div>}

        {reels.length > 0 && <div className="im-instagram-results">
          <div className="im-card-head">
            <div><span className="im-kicker">SELEÇÃO</span><h3>Escolha os Reels</h3></div>
            <button className="im-ghost" type="button" onClick={toggleAll} disabled={available.length === 0}>
              {selected.size === available.length && available.length ? "Desmarcar todos" : "Selecionar todos"}
            </button>
          </div>

          <div className="im-instagram-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,maxHeight:480,overflowY:"auto"}}>
            {reels.map(reel => (
              <label key={reel.id} className={"im-instagram-reel-card " + (selected.has(reel.id) ? "selected " : "") + (reel.duplicate ? "duplicate" : "")}>
                <input type="checkbox" checked={selected.has(reel.id)} disabled={reel.duplicate || importing} onChange={() => toggleReel(reel.id)} />
                {reel.thumbnail
                  ? <img src={reel.thumbnail} alt="" loading="lazy" />
                  : <div className="im-instagram-thumb-placeholder">REEL</div>}
                <div className="im-instagram-reel-copy">
                  <strong>{reel.title}</strong>
                  <span>{reel.duplicate ? "Já está nesta biblioteca" : "Disponível para importação"}</span>
                </div>
              </label>
            ))}
          </div>
        </div>}

        <div className="im-modal-actions">
          <span>{selectedCount} selecionado{selectedCount === 1 ? "" : "s"}</span>
          <div>
            <button className="im-ghost" type="button" disabled={importing} onClick={() => setOpen(false)}>Cancelar</button>
            <button className="im-primary" type="button" disabled={importing || !selectedCount || !libraryId} onClick={() => void importSelected()}>
              {importing ? "Importando…" : `Importar ${selectedCount || ""} Reel${selectedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>}
  </>;
}
