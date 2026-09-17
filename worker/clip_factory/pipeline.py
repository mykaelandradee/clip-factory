from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from .ai import select_clips
from .config import settings
from .models import ProjectResult
from .render import render_vertical
from .transcription import transcribe
from .youtube import download_video


def _safe_project_id(value: str | None) -> str:
    if value:
        cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
        if cleaned:
            return cleaned[:80]
    return uuid.uuid4().hex[:12]


def run_pipeline(url: str, provider: str = "openai", count: int = 5, min_duration: int = 20, max_duration: int = 60, render: bool = True) -> ProjectResult:
    settings.ensure_dirs()
    project_id = _safe_project_id(None)
    project_dir = settings.data_dir / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    source, _ = download_video(url, project_dir)
    transcript_file = project_dir / "transcript.json"
    segments = transcribe(source, transcript_file, settings.whisper_model)
    candidates = select_clips(provider, segments, count, min_duration, max_duration, settings)

    rendered: list[str] = []
    if render:
        for index, candidate in enumerate(candidates, start=1):
            output = project_dir / f"clip-{index:02d}.mp4"
            render_vertical(source, candidate, output)
            rendered.append(str(output))

    result = ProjectResult(project_id, url, str(source), str(transcript_file), candidates, rendered)
    (project_dir / "result.json").write_text(json.dumps(result.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return result
