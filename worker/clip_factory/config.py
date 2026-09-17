from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path(os.getenv("CLIP_FACTORY_DATA_DIR", "./worker/data"))
    whisper_model: str = os.getenv(
        "WHISPER_MODEL",
        "tiny" if os.getenv("RENDER") == "true" else "small",
    )
    ollama_url: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.2")
    web_url: str = os.getenv("CLIP_FACTORY_WEB_URL", "http://localhost:3000")
    worker_host: str = os.getenv("CLIP_FACTORY_WORKER_HOST", "127.0.0.1")
    worker_port: int = int(
        os.getenv("PORT", os.getenv("CLIP_FACTORY_WORKER_PORT", "8765"))
    )
    worker_token: str | None = os.getenv("CLIP_FACTORY_WORKER_TOKEN")

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "downloads").mkdir(exist_ok=True)
        (self.data_dir / "projects").mkdir(exist_ok=True)
        (self.data_dir / "output").mkdir(exist_ok=True)


settings = Settings()
