from __future__ import annotations

import json
import os
import time
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
    upload_started = time.perf_counter()
    account_id = env("R2_ACCOUNT_ID")
    bucket = env("R2_BUCKET_NAME")
    public_url = env("R2_PUBLIC_URL").rstrip("/")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    job_id = env("JOB_ID")
    requested_count = max(1, min(int(os.environ.get("COUNT", "5")), MAX_CLIPS_PER_JOB))

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    result_files = sorted(
        Path("data/projects").glob("*/result.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not result_files:
        raise RuntimeError("No completed project result was found.")

    project_dir = result_files[0].parent
    clip_files = sorted(project_dir.glob("clip-*.mp4"))
    if not clip_files:
        raise RuntimeError("No rendered MP4 clips were found.")
    if len(clip_files) != requested_count:
        raise RuntimeError(
            f"R2 upload blocked: rendered {len(clip_files)} clips, "
            f"but the job requested {requested_count}."
        )

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

    # Remove stale objects from a previous attempt for the same job so the
    # result can never expose clips that belong to an older retry.
    stale_response = client.list_objects_v2(Bucket=bucket, Prefix=f"jobs/{job_id}/")
    stale_objects = [{"Key": obj["Key"]} for obj in stale_response.get("Contents", []) if obj.get("Key")]
    if stale_objects:
        client.delete_objects(Bucket=bucket, Delete={"Objects": stale_objects, "Quiet": True})
        print(f"Removed {len(stale_objects)} stale R2 object(s) for job {job_id}")

    uploaded = []
    for path in clip_files:
        key = f"jobs/{job_id}/{path.name}"
        with path.open("rb") as handle:
            client.upload_fileobj(
                handle,
                bucket,
                key,
                ExtraArgs={"ContentType": "video/mp4", "CacheControl": "public, max-age=31536000, immutable"},
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

    upload_seconds = round(time.perf_counter() - upload_started, 2)
    print(f"[timing] r2_upload_total={upload_seconds:.2f}s")

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
                "uploadSeconds": upload_seconds,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
