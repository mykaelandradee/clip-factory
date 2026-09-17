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
        # Keep yt-dlp's current default clients and add web_embedded as a
        # fallback. Forcing only web_embedded/tv can fail when YouTube changes
        # the player response or requires a different client for the video.
        "extractor_args": {
            "youtube": {
                "player_client": ["default", "web_embedded"],
            },
        },
        # Keep EJS challenge scripts current inside the container. Deno is
        # installed by the worker Dockerfile and yt-dlp[default] provides EJS.
        "remote_components": ["ejs:npm"],
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = Path(ydl.prepare_filename(info))
        if filename.suffix.lower() != ".mp4":
            merged = filename.with_suffix(".mp4")
            if merged.exists():
                filename = merged
        return filename, info
