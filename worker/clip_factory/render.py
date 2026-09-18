from __future__ import annotations

import subprocess
from pathlib import Path

from .models import ClipCandidate, TranscriptSegment


def _srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_srt(
    candidate: ClipCandidate,
    segments: list[TranscriptSegment],
    output: Path,
) -> Path:
    """Create timed subtitles using the original Whisper segment timestamps."""
    entries: list[str] = []
    index = 1

    for segment in segments:
        start = max(segment.start, candidate.start)
        end = min(segment.end, candidate.end)
        text = " ".join(segment.text.split())
        if end <= start or not text:
            continue

        relative_start = start - candidate.start
        relative_end = end - candidate.start
        entries.append(
            f"{index}\n"
            f"{_srt_time(relative_start)} --> {_srt_time(relative_end)}\n"
            f"{text}\n"
        )
        index += 1

    # Fallback for an unusually sparse transcript.
    if not entries and candidate.transcript.strip():
        text = " ".join(candidate.transcript.split())
        entries.append(
            f"1\n{_srt_time(0)} --> {_srt_time(candidate.duration)}\n{text}\n"
        )

    output.write_text("\n".join(entries), encoding="utf-8")
    return output


def render_vertical(
    source: Path,
    candidate: ClipCandidate,
    output: Path,
    segments: list[TranscriptSegment],
) -> Path:
    """Render a 9:16 MP4 with correctly timed burned-in captions."""
    output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_file = output.with_suffix(".srt")
    write_srt(candidate, segments, subtitle_file)

    subtitle_path = str(subtitle_file.resolve()).replace("\\", "/").replace(":", "\\:")
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,"
        f"subtitles='{subtitle_path}':charenc=UTF-8:force_style='FontName=Arial,"
        "FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,"
        "Alignment=2,MarginV=220'"
    )

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{candidate.start:.3f}",
        "-i", str(source),
        "-t", f"{candidate.duration:.3f}",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(output),
    ]
    subprocess.run(cmd, check=True)
    return output
