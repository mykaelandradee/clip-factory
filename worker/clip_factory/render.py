from __future__ import annotations

import subprocess
from pathlib import Path

from .models import ClipCandidate


def _escape_filter_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def render_vertical(source: Path, candidate: ClipCandidate, output: Path) -> Path:
    """Render a 9:16 MP4, center-cropping the source and burning a simple caption."""
    output.parent.mkdir(parents=True, exist_ok=True)
    title = _escape_filter_text(candidate.title)
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,"
        "setsar=1,"
        f"drawtext=text='{title}':fontcolor=white:fontsize=58:"
        "borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.78:"
        "box=1:boxcolor=black@0.45:boxborderw=24"
    )
    cmd = [
        "ffmpeg", "-y", "-ss", f"{candidate.start:.3f}", "-i", str(source),
        "-t", f"{candidate.duration:.3f}", "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(cmd, check=True)
    return output
