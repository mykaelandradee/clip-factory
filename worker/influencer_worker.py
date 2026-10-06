from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

import boto3
from botocore.config import Config

from clip_factory.youtube import download_video

MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def report(stage: str, progress: int, message: str) -> None:
    print(f"[influencer-progress] {progress}% {stage}: {message}", flush=True)


def make_vertical(source: Path, output: Path) -> None:
    # Center-crop the original into a real 9:16 Reel. No letterboxing.
    command = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(source),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(output),
    ]
    subprocess.run(command, check=True)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--item-id", required=True)
    p.add_argument("--profile-id", required=False, default="")
    p.add_argument("--library-id", required=True)
    p.add_argument("--user-id", required=True)
    a = p.parse_args()

    started = time.perf_counter()
    data_dir = Path(os.environ.get("CLIP_FACTORY_DATA_DIR", "data"))
    d = data_dir / "influencer" / a.item_id
    d.mkdir(parents=True, exist_ok=True)

    report("download", 10, "Baixando vídeo original...")
    source, info = download_video(a.url, d)
    report("download", 45, "Download concluído.")

    original = d / "original.mp4"
    if source.resolve() != original.resolve():
        if original.exists():
            original.unlink()
        source.rename(original)

    if not original.is_file() or original.stat().st_size < 1024:
        raise RuntimeError("O vídeo baixado é inválido ou está vazio.")

    vertical = d / "video.mp4"
    report("render", 60, "Convertendo vídeo para 9:16...")
    make_vertical(original, vertical)
    report("render", 75, "Vídeo 9:16 pronto.")

    account_id = env("R2_ACCOUNT_ID")
    bucket = env("R2_BUCKET_NAME")
    public_url = env("R2_PUBLIC_URL").rstrip("/")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    report("upload", 80, "Enviando Reel 9:16 para o R2...")
    key = f"influencer/{a.user_id}/libraries/{a.library_id}/{a.item_id}/video.mp4"
    size = vertical.stat().st_size

    current = 0
    token = None
    while True:
        kw = {"Bucket": bucket}
        if token:
            kw["ContinuationToken"] = token
        resp = client.list_objects_v2(**kw)
        current += sum(int(o.get("Size", 0)) for o in resp.get("Contents", []))
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")

    if current + size > MAX_STORAGE_BYTES:
        raise RuntimeError("Upload bloqueado pelo limite interno de armazenamento do R2.")

    with vertical.open("rb") as handle:
        client.upload_fileobj(
            handle,
            bucket,
            key,
            ExtraArgs={
                "ContentType": "video/mp4",
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )

    result = {
        "itemId": a.item_id,
        "profileId": a.profile_id,
        "libraryId": a.library_id,
        "key": key,
        "url": f"{public_url}/{key}",
        "size": size,
        "title": str(info.get("title") or ""),
        "description": str(info.get("description") or ""),
        "duration": float(info.get("duration") or 0),
        "elapsed": round(time.perf_counter() - started, 2),
        "aspect_ratio": "9:16",
    }
    Path("data").mkdir(exist_ok=True)
    Path("data/influencer-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    report("ready", 100, "Reel 9:16 pronto na biblioteca.")


if __name__ == "__main__":
    main()
