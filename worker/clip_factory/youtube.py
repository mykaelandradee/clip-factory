from __future__ import annotations

import base64
import os
from pathlib import Path

import yt_dlp

from .config import settings


COOKIE_ENV_VAR = "YOUTUBE_COOKIES_B64"
COOKIE_FILE = "youtube_cookies.txt"


def prepare_youtube_cookies() -> Path | None:
    """Materialize YouTube cookies from the Render secret, if configured."""
    encoded = os.getenv(COOKIE_ENV_VAR, "").strip()
    if not encoded:
        return None

    cookie_path = settings.data_dir / COOKIE_FILE
    try:
        cookie_bytes = base64.b64decode(encoded, validate=False)
    except Exception as exc:
        raise RuntimeError("YOUTUBE_COOKIES_B64 não contém Base64 válido") from exc

    if not cookie_bytes.strip():
        raise RuntimeError("YOUTUBE_COOKIES_B64 está vazio após decodificação")

    cookie_path.parent.mkdir(parents=True, exist_ok=True)
    cookie_path.write_bytes(cookie_bytes)
    return cookie_path


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
