from __future__ import annotations

import json
from pathlib import Path

from .models import TranscriptSegment


def transcribe(video_path: Path, output_json: Path, model_name: str) -> list[TranscriptSegment]:
    """Transcribe with Whisper and persist timestamped segments."""
    import whisper

    model = whisper.load_model(model_name)
    result = model.transcribe(str(video_path), verbose=False, fp16=False)
    segments = [
        TranscriptSegment(float(s["start"]), float(s["end"]), s["text"].strip())
        for s in result.get("segments", [])
        if s.get("text", "").strip()
    ]
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
