// Modos de processamento dos vídeos da biblioteca do Influencer Manager.
// Os valores precisam ser os mesmos do worker (worker/clip_factory/influencer_processing.py).

export const PROCESSING_MODES = ["original", "captioned", "clips"] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export const CAPTION_STYLES = ["karaoke", "fire", "beasty", "youshaei", "harmozi", "cinematic"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export const DEFAULT_CAPTION_STYLE: CaptionStyle = "karaoke";

export const CLIP_COUNT_MIN = 1;
export const CLIP_COUNT_MAX = 10;
export const DEFAULT_CLIP_COUNT = 5;

export const PROCESSING_MODE_LABEL: Record<ProcessingMode, string> = {
  original: "Original",
  captioned: "Legendado",
  clips: "Cortes",
};

export const PROCESSING_MODE_HELP: Record<ProcessingMode, string> = {
  original: "Salva o vídeo inteiro em 9:16, sem legenda. Para Reels e Shorts já prontos.",
  captioned: "Mantém o vídeo inteiro e adiciona legenda. Até 3 minutos.",
  clips: "Encontra os melhores momentos de um vídeo longo e gera cortes legendados de 20 a 60 s.",
};

export const CAPTION_STYLE_LABEL: Record<CaptionStyle, string> = {
  karaoke: "Karaokê",
  fire: "Fire",
  beasty: "Beasty",
  youshaei: "Youshaei",
  harmozi: "Hormozi",
  cinematic: "Cinematográfico",
};

export function normalizeProcessingMode(value: unknown): ProcessingMode {
  return typeof value === "string" && (PROCESSING_MODES as readonly string[]).includes(value) ? (value as ProcessingMode) : "original";
}

export function normalizeCaptionStyle(value: unknown, fallback: CaptionStyle = DEFAULT_CAPTION_STYLE): CaptionStyle {
  return typeof value === "string" && (CAPTION_STYLES as readonly string[]).includes(value) ? (value as CaptionStyle) : fallback;
}

export function normalizeClipCount(value: unknown): number {
  const count = Math.trunc(Number(value));
  if (!Number.isFinite(count)) return DEFAULT_CLIP_COUNT;
  return Math.max(CLIP_COUNT_MIN, Math.min(CLIP_COUNT_MAX, count));
}

export type ManifestOutput = { index: number; key: string; start: number; end: number; duration: number; transcript: string; title: string };
export type ProcessingManifest = {
  version: number; item_id: string; mode: ProcessingMode; caption_style: CaptionStyle | null;
  source_title: string; source_description: string; source_duration: number; transcript: string;
  outputs: ManifestOutput[];
};

/**
 * Valida o manifesto gravado pelo worker no R2. Só aceita chaves dentro da
 * pasta do próprio item, para que um manifesto adulterado não aponte para
 * arquivos de outros usuários ou bibliotecas.
 */
export function parseManifest(raw: unknown, expectedPrefix: string): ProcessingManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.outputs) || data.outputs.length === 0 || data.outputs.length > CLIP_COUNT_MAX) return null;
  const outputs: ManifestOutput[] = [];
  for (const entry of data.outputs) {
    const o = entry as Record<string, unknown>;
    const key = typeof o?.key === "string" ? o.key : "";
    if (!key.startsWith(expectedPrefix + "/") || key.includes("..") || !key.endsWith(".mp4")) return null;
    const start = Number(o.start), end = Number(o.end);
    outputs.push({
      index: Math.trunc(Number(o.index)) || outputs.length + 1,
      key,
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : 0,
      duration: Number.isFinite(end - start) ? Math.max(0, end - start) : 0,
      transcript: typeof o.transcript === "string" ? o.transcript.slice(0, 20000) : "",
      title: typeof o.title === "string" ? o.title.slice(0, 300) : "",
    });
  }
  return {
    version: Number(data.version) || 1,
    item_id: String(data.item_id || ""),
    mode: normalizeProcessingMode(data.mode),
    caption_style: data.caption_style ? normalizeCaptionStyle(data.caption_style) : null,
    source_title: typeof data.source_title === "string" ? data.source_title.slice(0, 500) : "",
    source_description: typeof data.source_description === "string" ? data.source_description.slice(0, 5000) : "",
    source_duration: Number(data.source_duration) || 0,
    transcript: typeof data.transcript === "string" ? data.transcript.slice(0, 20000) : "",
    outputs: outputs.sort((a, b) => a.index - b.index),
  };
}

export function formatClipRange(start: number | null | undefined, end: number | null | undefined) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  if (start == null || end == null) return "";
  return `${fmt(Number(start))}–${fmt(Number(end))}`;
}
