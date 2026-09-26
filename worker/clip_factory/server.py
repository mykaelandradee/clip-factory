from __future__ import annotations

import json
import mimetypes
import subprocess
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import requests

from .config import settings

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def update_job(job_id: str, **changes) -> None:
    with jobs_lock:
        jobs.setdefault(job_id, {}).update(changes)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _authorized(self) -> bool:
        if not settings.worker_token:
            return True
        return self.headers.get("Authorization", "") == f"Bearer {settings.worker_token}"

    def do_OPTIONS(self) -> None:
        self._send(204, b"", "text/plain")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/health":
            self._json(200, {"status": "ok", "service": "clip-factory-worker"})
            return
        if not self._authorized():
            self._json(401, {"error": "Não autorizado"})
            return
        if path == "/diagnostic/youtube":
            self._youtube_diagnostic(parsed)
            return
        if path.startswith("/jobs/"):
            job_id = path.split("/", 2)[2]
            with jobs_lock:
                job = jobs.get(job_id)
            if not job:
                self._json(404, {"error": "Job não encontrado"})
            else:
                self._json(200, {"jobId": job_id, **job})
            return
        if path.startswith("/files/"):
            relative = unquote(path[len("/files/"):]).replace("\\", "/")
            if ".." in Path(relative).parts:
                self._json(400, {"error": "Caminho inválido"})
                return
            file_path = (settings.data_dir / relative).resolve()
            if not file_path.is_file() or settings.data_dir.resolve() not in file_path.parents:
                self._json(404, {"error": "Arquivo não encontrado"})
                return
            self._send(200, file_path.read_bytes(), mimetypes.guess_type(file_path.name)[0] or "application/octet-stream")
            return
        self._json(404, {"error": "Not found"})

    def _youtube_diagnostic(self, parsed) -> None:
        query = parse_qs(parsed.query)
        url = str(query.get("url", [""])[0]).strip()
        if not url:
            self._json(400, {"error": "Informe ?url= com a URL do YouTube"})
            return

        hostname = (urlparse(url).hostname or "").lower()
        allowed_hosts = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}
        if hostname not in allowed_hosts:
            self._json(400, {"error": "Apenas URLs do YouTube são permitidas neste diagnóstico"})
            return

        raw_http = {
            "ok": False,
            "status_code": None,
            "final_url": None,
            "content_type": None,
            "server": None,
            "retry_after": None,
            "content_length": None,
            "body_length": None,
        }
        try:
            response = requests.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36",
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                },
                timeout=(15, 30),
                allow_redirects=True,
            )
            raw_http.update({
                "ok": response.ok,
                "status_code": response.status_code,
                "final_url": response.url,
                "content_type": response.headers.get("content-type"),
                "server": response.headers.get("server"),
                "retry_after": response.headers.get("retry-after"),
                "content_length": response.headers.get("content-length"),
                "body_length": len(response.content),
            })
        except requests.RequestException as exc:
            raw_http["error"] = str(exc)

        cookie_path = None
        cookie_error = None
        try:
            from .youtube import prepare_youtube_cookies
            cookie_path = prepare_youtube_cookies()
        except Exception as exc:
            cookie_error = str(exc)

        command = [
            "yt-dlp",
            "-v",
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
        ]
        if cookie_path:
            command.extend(["--cookies", str(cookie_path)])
        command.append(url)

        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            stdout = completed.stdout.strip()
            stderr = completed.stderr.strip()
            result = {
                "raw_http": raw_http,
                "cookies": {
                    "configured": cookie_path is not None,
                    "file_exists": bool(cookie_path and cookie_path.is_file()),
                    "file_size": cookie_path.stat().st_size if cookie_path and cookie_path.is_file() else 0,
                    "error": cookie_error,
                },
                "yt_dlp": {
                    "ok": completed.returncode == 0,
                    "returncode": completed.returncode,
                    "command": [
                        "yt-dlp",
                        "-v",
                        "--dump-single-json",
                        "--skip-download",
                        "--no-playlist",
                        "--cookies",
                        "<cookies-file>",
                        "<youtube-url>",
                    ] if cookie_path else [
                        "yt-dlp",
                        "-v",
                        "--dump-single-json",
                        "--skip-download",
                        "--no-playlist",
                        "<youtube-url>",
                    ],
                    "log": stderr[-16000:],
                },
            }
            if completed.returncode == 0 and stdout:
                try:
                    info = json.loads(stdout)
                    result["yt_dlp"]["video"] = {
                        "id": info.get("id"),
                        "title": info.get("title"),
                        "channel": info.get("channel") or info.get("uploader"),
                        "duration": info.get("duration"),
                        "webpage_url": info.get("webpage_url"),
                    }
                except json.JSONDecodeError:
                    result["yt_dlp"]["stdout_tail"] = stdout[-4000:]
            elif stdout:
                result["yt_dlp"]["stdout_tail"] = stdout[-4000:]
            self._json(200, result)
        except subprocess.TimeoutExpired as exc:
            self._json(200, {
                "raw_http": raw_http,
                "cookies": {
                    "configured": cookie_path is not None,
                    "file_exists": bool(cookie_path and cookie_path.is_file()),
                    "file_size": cookie_path.stat().st_size if cookie_path and cookie_path.is_file() else 0,
                    "error": cookie_error,
                },
                "yt_dlp": {
                    "ok": False,
                    "timeout": True,
                    "error": "yt-dlp excedeu o limite de 90 segundos",
                    "stdout_tail": (exc.stdout or "")[-4000:],
                    "stderr_tail": (exc.stderr or "")[-16000:],
                },
            })
        except Exception as exc:
            self._json(500, {"raw_http": raw_http, "cookies": {"configured": cookie_path is not None, "error": cookie_error}, "yt_dlp": {"ok": False, "error": str(exc)}})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/jobs":
            self._json(404, {"error": "Not found"})
            return
        if not self._authorized():
            self._json(401, {"error": "Não autorizado"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            url = str(payload.get("url", "")).strip()
            if not url:
                raise ValueError("URL do YouTube é obrigatória")
            provider = str(payload.get("provider", "openai"))
            count = int(payload.get("count", 5))
            min_duration = int(payload.get("min_duration", 20))
            max_duration = int(payload.get("max_duration", 60))
            if provider not in {"openai", "anthropic", "ollama"}:
                raise ValueError("Provedor de IA inválido")
            if not 1 <= count <= 20 or min_duration < 5 or max_duration <= min_duration:
                raise ValueError("Configuração de processamento inválida")
            job_id = str(uuid.uuid4())
            update_job(job_id, status="queued", progress=0, message="Na fila", result=None, error=None)
            threading.Thread(target=self._run, args=(job_id, payload), daemon=True).start()
            self._json(202, {"jobId": job_id, "status": "queued"})
        except Exception as exc:
            self._json(400, {"error": str(exc)})

    @staticmethod
    def _run(job_id: str, payload: dict) -> None:
        try:
            update_job(job_id, status="processing", progress=1, message="Iniciando processamento")

            def progress(stage: str, percent: int, message: str) -> None:
                update_job(job_id, status="processing", stage=stage, progress=percent, message=message)

            from .pipeline import run_pipeline

            result = run_pipeline(
                str(payload["url"]),
                provider=str(payload.get("provider", "openai")),
                count=int(payload.get("count", 5)),
                min_duration=int(payload.get("min_duration", 20)),
                max_duration=int(payload.get("max_duration", 60)),
                render=True,
                progress=progress,
            )
            data = result.to_dict()
            data["files"] = [
                {
                    "name": Path(p).name,
                    "url": "/files/" + str(Path(p).relative_to(settings.data_dir)).replace("\\", "/"),
                }
                for p in result.rendered_files
            ]
            update_job(job_id, status="completed", progress=100, message="Clips prontos", result=data)
        except Exception as exc:
            update_job(job_id, status="failed", progress=100, message="Processamento falhou", error=str(exc))
            print(f"Job {job_id} failed: {exc}")


def main() -> None:
    settings.ensure_dirs()
    server = ThreadingHTTPServer((settings.worker_host, settings.worker_port), Handler)
    print(f"Starting Clip Factory worker on {settings.worker_host}:{settings.worker_port}", flush=True)
    print(f"Clip Factory worker listening on http://{settings.worker_host}:{settings.worker_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
