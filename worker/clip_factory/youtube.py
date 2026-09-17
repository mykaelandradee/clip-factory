from __future__ import annotations

from pathlib import Path

import yt_dlp


def download_video(url: str, output_dir: Path) -> tuple[Path, dict]:
    """Download a YouTube video and return the local file plus metadata."""
    output_dir.mkdir(parents=True, exist_ok=True)
    template = str(output_dir / "source.%(ext)s")
    options = {
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": template,
        "noplaylist": True,
        "quiet": False,
        "no_warnings": False,
        "verbose": True,
        # Let the installed yt-dlp version choose its current YouTube clients.
        # Forcing a client can make extraction fail when YouTube changes its
        # player responses.
        "js_runtimes": {
            "deno": {},
        },
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = Path(ydl.prepare_filename(info))
        if filename.suffix.lower() != ".mp4":
            merged = filename.with_suffix(".mp4")
            if merged.exists():
                filename = merged
        return filename, info
