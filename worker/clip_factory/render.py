from __future__ import annotations

import subprocess
from pathlib import Path

from .models import ClipCandidate


def _srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_srt(candidate: ClipCandidate, output: Path) -> Path:
    """Create a subtitle file from the transcript text for this candidate."""
    text = " ".join(candidate.transcript.split())
    output.write_text(
        f"1\n{_srt_time(0)} --> {_srt_time(candidate.duration)}\n{text}\n" if text else "",
        encoding="utf-8",
    )
    return output


def render_vertical(source: Path, candidate: ClipCandidate, output: Path) -> Path:
    """Render a 9:16 MP4, center-cropping the source and burning captions."""
    output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_file = output.with_suffix(".srt")
    write_srt(candidate, subtitle_file)
    subtitle_path = str(subtitle_file.resolve()).replace("\\", "/").replace(":", "\\:")
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,"
        f"subtitles='{subtitle_path}':force_style='FontName=Arial,FontSize=20,"
        "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,"
        "Alignment=2,MarginV=220'"
    )
    cmd = [
        "ffmpeg", "-y", "-ss", f"{candidate.start:.3f}", "-i", str(source),
        "-t", f"{candidate.duration:.3f}", "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(cmd, check=True)
    return output
