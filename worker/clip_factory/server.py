from __future__ import annotations

import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import settings
from .pipeline import run_pipeline


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._json(204, {})

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok", "service": "clip-factory-worker"})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/jobs":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not payload.get("url"):
                raise ValueError("URL do YouTube é obrigatória")
            job_id = str(uuid.uuid4())
            thread = threading.Thread(target=self._run, args=(job_id, payload), daemon=True)
            thread.start()
            self._json(202, {"jobId": job_id, "status": "processing"})
        except Exception as exc:
            self._json(400, {"error": str(exc)})

    @staticmethod
    def _run(job_id: str, payload: dict) -> None:
        try:
            run_pipeline(payload, settings, job_id)
        except Exception as exc:
            print(f"Job {job_id} failed: {exc}")


def main() -> None:
    settings.ensure_dirs()
    server = ThreadingHTTPServer((settings.worker_host, settings.worker_port), Handler)
    print(f"Clip Factory worker listening on http://{settings.worker_host}:{settings.worker_port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
