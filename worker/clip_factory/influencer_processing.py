"""Regras do processamento de vídeos da biblioteca do Influencer Manager.

Funções puras (sem Whisper, FFmpeg ou rede), para serem testadas no CI.
O worker (`influencer_worker.py`) usa estas regras para decidir o que gerar e
grava um manifesto no R2 que o web lê para criar os itens da biblioteca.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

PROCESSING_MODES = ("original", "captioned", "clips")
CAPTION_STYLES = ("karaoke", "fire", "beasty", "youshaei", "harmozi", "cinematic")
DEFAULT_CAPTION_STYLE = "karaoke"

MIN_CLIPS = 1
MAX_CLIPS = 10
CLIP_MIN_SECONDS = 20
CLIP_MAX_SECONDS = 60
# Reels e Shorts aceitam até 3 minutos; vídeos maiores precisam ser cortados.
CAPTIONED_MAX_SECONDS = 180
TRANSCRIPT_MAX_CHARS = 20000


def normalize_mode(value: str | None) -> str:
    mode = (value or "original").strip().lower()
    if mode not in PROCESSING_MODES:
        raise ValueError(f"Modo de processamento inválido: {value!r}.")
    return mode


def normalize_caption_style(value: str | None) -> str:
    style = (value or DEFAULT_CAPTION_STYLE).strip().lower()
    return style if style in CAPTION_STYLES else DEFAULT_CAPTION_STYLE


def normalize_clip_count(value: Any) -> int:
    try:
        count = int(value)
    except (TypeError, ValueError):
        count = 5
    return max(MIN_CLIPS, min(MAX_CLIPS, count))


def validate_duration(mode: str, duration: float) -> None:
    """Rejeita combinações que não geram um vídeo publicável."""
    if mode == "captioned" and duration > CAPTIONED_MAX_SECONDS:
        minutes = CAPTIONED_MAX_SECONDS // 60
        raise ValueError(
            f"O modo Legendado aceita vídeos de até {minutes} minutos. "
            "Para vídeos mais longos, use o modo Cortes."
        )
    if mode == "clips" and duration and duration < CLIP_MIN_SECONDS:
        raise ValueError(
            f"O vídeo tem {int(duration)} s, curto demais para cortes "
            f"(mínimo de {CLIP_MIN_SECONDS} s). Use o modo Original ou Legendado."
        )


def item_prefix(user_id: str, library_id: str, item_id: str) -> str:
    return f"influencer/{user_id}/libraries/{library_id}/{item_id}"


def output_key(prefix: str, mode: str, index: int) -> str:
    # Original e Legendado mantêm o caminho histórico "video.mp4".
    return f"{prefix}/video.mp4" if mode != "clips" else f"{prefix}/clip-{index:02d}.mp4"


def manifest_key(prefix: str) -> str:
    return f"{prefix}/manifest.json"


def trim_transcript(text: str) -> str:
    clean = " ".join((text or "").split())
    return clean[:TRANSCRIPT_MAX_CHARS]


@dataclass
class OutputVideo:
    index: int
    key: str
    start: float
    end: float
    transcript: str = ""
    title: str = ""

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class Manifest:
    version: int
    item_id: str
    mode: str
    caption_style: str | None
    source_title: str
    source_description: str
    source_duration: float
    transcript: str
    outputs: list[OutputVideo] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["outputs"] = [dict(asdict(o), duration=round(o.duration, 3)) for o in self.outputs]
        return data
