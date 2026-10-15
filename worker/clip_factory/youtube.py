from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path

import yt_dlp

from .config import settings


COOKIE_ENV_VAR = "YOUTUBE_COOKIES_B64"
COOKIE_FILE_ENV_VAR = "YOUTUBE_COOKIES_FILE"
COOKIE_FILE_ENV_VAR_ALT = "YOUTUBE_COOKIE_FILE"
COOKIE_SECRET_FILE = Path("/etc/secrets/youtube_cookies.txt")
COOKIE_FILE = "youtube_cookies.txt"


def _write_private_file(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(content)
    os.chmod(path, 0o600)


def prepare_youtube_cookies() -> Path | None:
    """Resolve YouTube cookies from a configured file, encoded secret, or secret file."""
    cookie_file = (
        os.getenv(COOKIE_FILE_ENV_VAR, "").strip()
        or os.getenv(COOKIE_FILE_ENV_VAR_ALT, "").strip()
    )
    if cookie_file:
        configured_path = Path(cookie_file).expanduser()
        if not configured_path.is_file():
            raise RuntimeError(
                f"Arquivo de cookies configurado não existe: {configured_path}"
            )
        if not configured_path.stat().st_size:
            raise RuntimeError(
                f"Arquivo de cookies configurado está vazio: {configured_path}"
            )
        return configured_path

    encoded = os.getenv(COOKIE_ENV_VAR, "").strip()
    # Mantém os cookies fora do diretório de dados (que é servido/enviado como artefato)
    # e legíveis apenas pelo processo atual.
    secrets_dir = Path(tempfile.gettempdir()) / "clip-factory-secrets"
    cookie_path = secrets_dir / COOKIE_FILE

    if encoded:
        try:
            cookie_bytes = base64.b64decode(encoded, validate=False)
        except Exception as exc:
            raise RuntimeError("YOUTUBE_COOKIES_B64 não contém Base64 válido") from exc
        if not cookie_bytes.strip():
            raise RuntimeError("YOUTUBE_COOKIES_B64 está vazio após decodificação")
        _write_private_file(cookie_path, cookie_bytes)
        return cookie_path

    if COOKIE_SECRET_FILE.is_file():
        try:
            _write_private_file(cookie_path, COOKIE_SECRET_FILE.read_bytes())
        except OSError as exc:
            raise RuntimeError(f"Não foi possível copiar o Secret File de cookies: {exc}") from exc
        return cookie_path

    return None


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
        "js_runtimes": {"deno": {}},
        "extractor_args": {
            "youtube": {
                "player_client": ["mweb"],
            },
            "youtubepot-bgutilhttp": {
                "base_url": ["http://127.0.0.1:4416"],
            },
        },
        "sleep_interval_requests": 1,
    }

    from urllib.parse import urlparse
    host = (urlparse(url).hostname or "").lower()
    is_youtube = host == "youtube.com" or host.endswith(".youtube.com") or host == "youtu.be"
    if is_youtube:
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
