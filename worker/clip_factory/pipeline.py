from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    caption_style: str = "dynamic",
) -> ProjectResult:
    settings.ensure_dirs()
    count = max(1, min(int(count), 15))
    min_duration = max(10, int(min_duration))
    max_duration = max(min_duration, min(int(max_duration), 120))

    def report(stage: str, percent: int, message: str) -> None:
        if progress:
            progress(stage, percent, message)

    timings: dict[str, float] = {}
    pipeline_started = time.perf_counter()

    report("downloading", 5, "Baixando vídeo do YouTube...")
    stage_started = time.perf_counter()
    temp_dir = settings.data_dir / "downloads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    source, info = download_video(url, temp_dir)
    timings["download"] = round(time.perf_counter() - stage_started, 2)
    print(f"[timing] download={timings['download']:.2f}s")

    project_name = _safe_project_id(info.get("title") or source.stem)
    project_dir = settings.data_dir / "projects" / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    project_source = project_dir / source.name
    if source.resolve() != project_source.resolve():
        source.replace(project_source)
        source = project_source

    report("transcribing", 25, "Transcrevendo o vídeo com Whisper...")
    stage_started = time.perf_counter()
    transcript_file = project_dir / "transcript.json"
    segments = transcribe(source, transcript_file, settings.whisper_model, subtitle_language)
    timings["transcription"] = round(time.perf_counter() - stage_started, 2)
    print(f"[timing] transcription={timings['transcription']:.2f}s")

    report("analyzing", 55, "Selecionando os melhores trechos localmente...")
    stage_started = time.perf_counter()
    candidates = select_clips(provider, segments, count, min_duration, max_duration, settings)
    timings["selection"] = round(time.perf_counter() - stage_started, 2)
    print(f"[timing] selection={timings['selection']:.2f}s")
    if not candidates:
        raise RuntimeError("Não foram encontrados trechos dentro da duração solicitada.")

    rendered: list[str] = []
    if render:
        render_started = time.perf_counter()
        clip_timings: dict[str, float] = {}
        # Prevent stale clips from a previous run with the same project title
        # from being uploaded together with the new generation.
        for stale_clip in project_dir.glob("clip-*.mp4"):
            stale_clip.unlink()
        total = len(candidates)

        def render_one(index: int, candidate) -> tuple[int, str, float]:
            output = project_dir / f"clip-{index:02d}.mp4"
            started = time.perf_counter()
            render_vertical(source, candidate, output, segments, caption_style)
            elapsed = time.perf_counter() - started
            return index, str(output), elapsed

        # Stage 3: render two clips concurrently. FFmpeg is already capped at
        # two threads per process, which keeps the GitHub runner from being
        # oversubscribed while reducing wall-clock time.
        max_workers = min(2, total)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(render_one, index, candidate): index
                for index, candidate in enumerate(candidates, start=1)
            }
            completed = 0
            results: dict[int, str] = {}
            for future in as_completed(futures):
                index, output, elapsed = future.result()
                clip_timings[f"clip-{index:02d}"] = round(elapsed, 2)
                completed += 1
                percent = 70 + int(completed / total * 25)
                report("rendering", percent, f"Renderizando clip {completed} de {total}...")
                results[index] = output

        rendered = [results[index] for index in sorted(results)]
        timings["render"] = round(time.perf_counter() - render_started, 2)
        timings.update({f"render_{name}": value for name, value in clip_timings.items()})
        print(f"[timing] render_total={timings['render']:.2f}s")
        for name, value in sorted(clip_timings.items()):
            print(f"[timing] {name}={value:.2f}s")

    timings["total"] = round(time.perf_counter() - pipeline_started, 2)
    print(f"[timing] pipeline_total={timings['total']:.2f}s")

    report("completed", 100, "Processamento concluído.")
    result = ProjectResult(
        project_name,
        url,
        str(source),
        str(transcript_file),
        candidates,
        rendered,
        timings,
    )
    (project_dir / "result.json").write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result
