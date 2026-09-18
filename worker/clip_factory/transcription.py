from __future__ import annotations

import gc
import json
import os
from pathlib import Path

# Set conservative CPU threading before importing Whisper/PyTorch.
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

from .models import TranscriptSegment


def transcribe(
    video_path: Path,
    output_json: Path,
    model_name: str,
    subtitle_language: str = "original",
) -> list[TranscriptSegment]:
    """Transcribe with Whisper and keep word timestamps for readable captions."""
    import whisper

    if subtitle_language not in {"original", "en"}:
        raise ValueError("Idioma de legenda não suportado. Use original ou en.")

    model = whisper.load_model(model_name, device="cpu")
    try:
        result = model.transcribe(
            str(video_path),
            verbose=False,
            fp16=False,
            temperature=0,
            condition_on_previous_text=False,
            word_timestamps=True,
            task="translate" if subtitle_language == "en" else "transcribe",
        )
        segments = []
        for raw in result.get("segments", []):
            text = raw.get("text", "").strip()
            if not text:
                continue
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
    finally:
        del model
        gc.collect()

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
