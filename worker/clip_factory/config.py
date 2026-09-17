from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path(os.getenv("CLIP_FACTORY_DATA_DIR", "./worker/data"))
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5.6")
    anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
    ollama_url: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.2")
    web_url: str = os.getenv("CLIP_FACTORY_WEB_URL", "http://localhost:3000")
    worker_host: str = os.getenv("CLIP_FACTORY_WORKER_HOST", "127.0.0.1")
    worker_port: int = int(os.getenv("CLIP_FACTORY_WORKER_PORT", "8765"))

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "downloads").mkdir(exist_ok=True)
        (self.data_dir / "projects").mkdir(exist_ok=True)
        (self.data_dir / "output").mkdir(exist_ok=True)


settings = Settings()
