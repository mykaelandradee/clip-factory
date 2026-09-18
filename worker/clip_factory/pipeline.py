from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Callable

from .ai import select_clips
from .config import settings
from .models import ProjectResult
from .render import render_vertical
from .transcription import transcribe
from .youtube import download_video

Progress = Callable[[str, int, str], None]


def _safe_project_id(value: str | None) -> str:
    if value:
        cleaned = re.sub(r"[^a-zA-Z0-9À-ÿ_-]+", "-", value).strip("-")
        if cleaned:
            return cleaned[:80]
    return uuid.uuid4().hex[:12]


def run_pipeline(
    url: str,
    provider: str = "local",
    count: int = 5,
    min_duration: int = 20,
    max_duration: int = 60,
    render: bool = True,
    progress: Progress | None = None,
    subtitle_language: str = "original",
) -> ProjectResult:
    settings.ensure_dirs()

    def report(stage: str, percent: int, message: str) -> None:
        if progress:
            progress(stage, percent, message)

    report("downloading", 5, "Baixando vídeo do YouTube...")
    temp_dir = settings.data_dir / "downloads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    source, info = download_video(url, temp_dir)

    project_name = _safe_project_id(info.get("title") or source.stem)
    project_dir = settings.data_dir / "projects" / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    project_source = project_dir / source.name
    if source.resolve() != project_source.resolve():
        source.replace(project_source)
        source = project_source

    report("transcribing", 25, "Transcrevendo o vídeo com Whisper...")
    transcript_file = project_dir / "transcript.json"
    segments = transcribe(source, transcript_file, settings.whisper_model, subtitle_language)

    report("analyzing", 55, "Selecionando os melhores trechos localmente...")
    candidates = select_clips(provider, segments, count, min_duration, max_duration, settings)
    if not candidates:
        raise RuntimeError("Não foram encontrados trechos dentro da duração solicitada.")

    rendered: list[str] = []
    if render:
        total = len(candidates)
        for index, candidate in enumerate(candidates, start=1):
            percent = 70 + int((index - 1) / total * 25)
            report("rendering", percent, f"Renderizando clip {index} de {total}...")
            output = project_dir / f"clip-{index:02d}.mp4"
            render_vertical(source, candidate, output, segments)
            rendered.append(str(output))

    report("completed", 100, "Processamento concluído.")
    result = ProjectResult(project_name, url, str(source), str(transcript_file), candidates, rendered)
    (project_dir / "result.json").write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result
