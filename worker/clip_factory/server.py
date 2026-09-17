from __future__ import annotations

import json
import mimetypes
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .config import settings
from .pipeline import run_pipeline


JOBS: dict[str, dict] = {}
LOCK = threading.Lock()


def _set_job(job_id: str, **updates) -> None:
    with LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(updates)


def _job(job_id: str) -> dict | None:
    with LOCK:
        value = JOBS.get(job_id)
        return dict(value) if value else None


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, "application/json; charset=utf-8", json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self) -> None:
        self._send(204, "text/plain; charset=utf-8", b"")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self._json(200, {"status": "ok", "service": "clip-factory-worker"})
            return

        if path.startswith("/jobs/"):
            job_id = path.split("/", 2)[2]
            job = _job(job_id)
            if not job:
                self._json(404, {"error": "Job não encontrado"})
                return
            self._json(200, {"jobId": job_id, **job})
            return

        if path.startswith("/files/"):
            relative = unquote(path[len("/files/"):]).replace("\\", "/")
            file_path = (settings.data_dir / "projects" / relative).resolve()
            projects_root = (settings.data_dir / "projects").resolve()
            if projects_root not in file_path.parents or not file_path.is_file():
                self._json(404, {"error": "Arquivo não encontrado"})
                return
            content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            self._send(200, content_type, file_path.read_bytes())
            return

        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/jobs":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            url = str(payload.get("url", "")).strip()
            if not url:
                raise ValueError("URL do YouTube é obrigatória")
            if not ("youtube.com" in url or "youtu.be" in url):
                raise ValueError("Informe uma URL válida do YouTube")

            job_id = str(uuid.uuid4())
            with LOCK:
                JOBS[job_id] = {
                    "status": "queued",
                    "progress": 0,
                    "stage": "queued",
                    "message": "Na fila...",
                    "createdAt": __import__("datetime").datetime.now().isoformat(),
                }

            thread = threading.Thread(target=self._run, args=(job_id, payload), daemon=True)
            thread.start()
            self._json(202, {"jobId": job_id, "status": "queued"})
        except Exception as exc:
            self._json(400, {"error": str(exc)})

    @staticmethod
    def _run(job_id: str, payload: dict) -> None:
        def progress(stage: str, percent: int, message: str) -> None:
            _set_job(job_id, status="processing", stage=stage, progress=percent, message=message)

        try:
            result = run_pipeline(
                url=str(payload["url"]),
                provider=str(payload.get("provider", "openai")),
                count=int(payload.get("count", 5)),
                min_duration=int(payload.get("minDuration", 20)),
                max_duration=int(payload.get("maxDuration", 60)),
                render=True,
                progress=progress,
            )
            files = []
            for path in result.rendered_files:
                file_path = Path(path)
                files.append({
                    "name": file_path.name,
                    "url": f"http://{settings.worker_host}:{settings.worker_port}/files/{result.project_id}/{file_path.name}",
                })
            _set_job(job_id, status="completed", stage="completed", progress=100, message="Processamento concluído.", result={"projectId": result.project_id, "candidates": [c.to_dict() for c in result.candidates], "files": files})
        except Exception as exc:
            _set_job(job_id, status="failed", stage="error", progress=100, message=str(exc), error=str(exc))
            print(f"Job {job_id} failed: {exc}")


def main() -> None:
    settings.ensure_dirs()
    server = ThreadingHTTPServer((settings.worker_host, settings.worker_port), Handler)
    print(f"Clip Factory worker listening on http://{settings.worker_host}:{settings.worker_port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
