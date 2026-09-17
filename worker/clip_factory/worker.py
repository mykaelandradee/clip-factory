from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

from .config import settings


def fetch_job(base_url: str) -> dict | None:
    req = Request(f"{base_url.rstrip('/')}/api/jobs/next", headers={"Accept": "application/json"})
    with urlopen(req, timeout=30) as response:
        if response.status == 204:
            return None
        return json.loads(response.read().decode("utf-8"))


def update_job(base_url: str, job_id: str, payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        f"{base_url.rstrip('/')}/api/jobs/{job_id}",
        data=data,
        method="PATCH",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urlopen(req, timeout=30):
        pass


def process(job: dict) -> None:
    # Pipeline integration point. The concrete pipeline lives in pipeline.py and
    # can be executed locally without exposing the worker to the internet.
    from .pipeline import run_pipeline

    run_pipeline(job["request"], settings, job["jobId"])


def main() -> None:
    parser = argparse.ArgumentParser(description="Clip Factory worker")
    parser.add_argument("--once", action="store_true", help="process one queued job and exit")
    args = parser.parse_args()
    settings.ensure_dirs()

    while True:
        try:
            job = fetch_job(settings.web_url)
            if job:
                try:
                    update_job(settings.web_url, job["jobId"], {"status": "processing"})
                    process(job)
                    update_job(settings.web_url, job["jobId"], {"status": "completed"})
                except Exception as exc:
                    update_job(settings.web_url, job["jobId"], {"status": "failed", "error": str(exc)})
                if args.once:
                    return
            elif args.once:
                return
        except Exception as exc:
            print(f"Worker connection error: {exc}")
            if args.once:
                raise
        time.sleep(3)


if __name__ == "__main__":
    main()
