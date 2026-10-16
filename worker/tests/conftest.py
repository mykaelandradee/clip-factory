"""Configuração dos testes do worker.

O `settings` do worker lê o ambiente no import, então as variáveis são
definidas aqui, antes de qualquer teste importar `clip_factory`.
"""
import os
import sys
import tempfile
from pathlib import Path

DATA_DIR = Path(tempfile.mkdtemp(prefix="clip-factory-test-"))
os.environ["CLIP_FACTORY_DATA_DIR"] = str(DATA_DIR)
os.environ["CLIP_FACTORY_WORKER_TOKEN"] = "test-token"
os.environ["CLIP_FACTORY_WORKER_HOST"] = "127.0.0.1"
os.environ.pop("YOUTUBE_COOKIES_B64", None)
os.environ.pop("YOUTUBE_COOKIES_FILE", None)
os.environ.pop("YOUTUBE_COOKIE_FILE", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
