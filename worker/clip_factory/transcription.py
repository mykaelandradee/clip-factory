from __future__ import annotations

import gc
import json
import os
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

from .models import TranscriptSegment


def _translate_to_pt(texts: list[str]) -> list[str]:
    from transformers import pipeline

    translator = pipeline(
        "translation",
        model="Helsinki-NLP/opus-mt-en-pt",
        device=-1,
    )
    return [str(item["translation_text"]).strip() for item in translator(texts, batch_size=8)]


def transcribe(
    video_path: Path,
    output_json: Path,
    model_name: str,
    subtitle_language: str = "original",
) -> list[TranscriptSegment]:
    """Transcribe with Whisper and optionally translate captions to PT-BR locally."""
    import whisper

    if subtitle_language not in {"original", "pt-BR", "en"}:
        raise ValueError("Idioma de legenda não suportado.")

    model = whisper.load_model(model_name, device="cpu")
    try:
        # Whisper's translate task produces English. For PT-BR we first obtain
        # a faithful English transcription, then translate each segment locally.
        task = "translate" if subtitle_language in {"en", "pt-BR"} else "transcribe"
        result = model.transcribe(
            str(video_path),
            verbose=False,
            fp16=False,
            temperature=0,
            condition_on_previous_text=False,
            word_timestamps=True,
            task=task,
        )
    finally:
        del model
        gc.collect()

    raw_segments = [raw for raw in result.get("segments", []) if raw.get("text", "").strip()]
    if subtitle_language == "pt-BR":
        translated = _translate_to_pt([str(raw["text"]).strip() for raw in raw_segments])
    else:
        translated = [str(raw["text"]).strip() for raw in raw_segments]

    segments: list[TranscriptSegment] = []
    for raw, text in zip(raw_segments, translated):
        words = []
        for word in raw.get("words", []) or []:
            word_text = str(word.get("word", "")).strip()
            if not word_text:
                continue
            words.append({
                "start": float(word.get("start", raw["start"])),
                "end": float(word.get("end", raw["end"])),
                "text": word_text,
            })
        segments.append(
            TranscriptSegment(
                float(raw["start"]),
                float(raw["end"]),
                text,
                words,
            )
        )

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
