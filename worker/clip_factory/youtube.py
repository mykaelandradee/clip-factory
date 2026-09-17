from __future__ import annotations

import os
from pathlib import Path

import yt_dlp


COOKIE_FILE = "youtube_cookies.txt"
COOKIE_SECRET_PATH = Path(os.getenv("YOUTUBE_COOKIES_FILE", f"/etc/secrets/{COOKIE_FILE}"))


def prepare_youtube_cookies() -> Path | None:
    """Return the Render Secret File containing YouTube cookies, if configured."""
    if not COOKIE_SECRET_PATH.is_file():
        return None

    if COOKIE_SECRET_PATH.stat().st_size == 0:
        raise RuntimeError("O arquivo de cookies do YouTube está vazio")

    return COOKIE_SECRET_PATH


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
        "js_runtimes": {
            "deno": {},
        },
    }

    cookie_path = prepare_youtube_cookies()
    if cookie_path:
        options["cookiefile"] = str(cookie_path)

    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = Path(ydl.prepare_filename(info))
        if filename.suffix.lower() != ".mp4":
            merged = filename.with_suffix(".mp4")
            if merged.exists():
                filename = merged
        return filename, info
