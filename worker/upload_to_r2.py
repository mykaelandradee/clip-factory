from __future__ import annotations

import json
import os
from pathlib import Path

import boto3
from botocore.config import Config


MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024
MAX_CLIPS_PER_JOB = 15


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def main() -> None:
    account_id = env("R2_ACCOUNT_ID")
    bucket = env("R2_BUCKET_NAME")
    public_url = env("R2_PUBLIC_URL").rstrip("/")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    job_id = env("JOB_ID")

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    clip_files = sorted(Path("data/projects").glob("*/clip-*.mp4"))
    if not clip_files:
        raise RuntimeError("No rendered MP4 clips were found.")
    if len(clip_files) > MAX_CLIPS_PER_JOB:
        raise RuntimeError(f"R2 upload blocked: job contains more than {MAX_CLIPS_PER_JOB} clips.")

    current_storage = 0
    continuation_token = None
    while True:
        kwargs = {"Bucket": bucket}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**kwargs)
        current_storage += sum(int(obj.get("Size", 0)) for obj in response.get("Contents", []))
        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    batch_size = sum(path.stat().st_size for path in clip_files)
    projected_storage = current_storage + batch_size
    if projected_storage > MAX_STORAGE_BYTES:
        raise RuntimeError(
            "R2 upload blocked by the internal storage safety limit: "
            f"current={current_storage} bytes, batch={batch_size} bytes, "
            f"limit={MAX_STORAGE_BYTES} bytes."
        )

    uploaded = []
    for path in clip_files:
        key = f"jobs/{job_id}/{path.name}"
        with path.open("rb") as handle:
            client.upload_fileobj(
                handle,
                bucket,
                key,
                ExtraArgs={"ContentType": "video/mp4", "CacheControl": "public, max-age=3600"},
            )
        uploaded.append(
            {
                "file": path.name,
                "key": key,
                "url": f"{public_url}/{key}",
                "size": path.stat().st_size,
            }
        )
        print(f"Uploaded {path.name} -> {public_url}/{key}")

    output = Path("data/r2-urls.json")
    output.write_text(
        json.dumps(
            {
                "jobId": job_id,
                "bucket": bucket,
                "currentStorageBytesBeforeUpload": current_storage,
                "batchSizeBytes": batch_size,
                "projectedStorageBytes": projected_storage,
                "internalStorageLimitBytes": MAX_STORAGE_BYTES,
                "files": uploaded,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
