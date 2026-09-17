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


def transcribe(video_path: Path, output_json: Path, model_name: str) -> list[TranscriptSegment]:
    """Transcribe with Whisper using conservative CPU settings for low-memory hosts."""
    import whisper

    model = whisper.load_model(model_name, device="cpu")
    try:
        result = model.transcribe(
            str(video_path),
            verbose=False,
            fp16=False,
            temperature=0,
            condition_on_previous_text=False,
        )
        segments = [
            TranscriptSegment(float(s["start"]), float(s["end"]), s["text"].strip())
            for s in result.get("segments", [])
            if s.get("text", "").strip()
        ]
    finally:
        # Release Whisper before the AI/rendering stages run.
        del model
        gc.collect()

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
