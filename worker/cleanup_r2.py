from __future__ import annotations

import os
import time

import boto3
from botocore.config import Config

RETENTION_HOURS = 72
MAX_DELETE_PER_RUN = 500
MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def main() -> None:
    account_id = env("R2_ACCOUNT_ID")
    bucket = env("R2_BUCKET_NAME")
    access_key = env("R2_ACCESS_KEY_ID")
    secret_key = env("R2_SECRET_ACCESS_KEY")
    job_id = os.environ.get("JOB_ID", "").strip()
    cutoff = time.time() - RETENTION_HOURS * 3600

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    objects = []
    continuation_token = None

    while True:
        kwargs = {"Bucket": bucket, "Prefix": "jobs/"}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**kwargs)

        for obj in response.get("Contents", []):
            key = obj.get("Key", "")
            if not key.lower().endswith(".mp4"):
                continue
            if job_id and key.startswith(f"jobs/{job_id}/"):
                continue
            objects.append(obj)

        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    total_bytes = sum(int(obj.get("Size", 0)) for obj in objects)

    expired = [
        obj for obj in objects
        if obj.get("LastModified") is not None
        and obj["LastModified"].timestamp() < cutoff
    ]

    candidates = expired

    # If storage exceeds the safety threshold, continue with the oldest
    # remaining clips after the normal 72-hour retention candidates.
    if total_bytes > MAX_STORAGE_BYTES:
        expired_keys = {obj["Key"] for obj in expired}
        for obj in sorted(objects, key=lambda item: item.get("LastModified")):
            if obj["Key"] not in expired_keys:
                candidates.append(obj)

    candidates.sort(key=lambda item: item.get("LastModified"))
    selected = candidates[:MAX_DELETE_PER_RUN]

    deleted = 0
    deleted_bytes = 0

    for obj in selected:
        client.delete_object(Bucket=bucket, Key=obj["Key"])
        deleted += 1
        deleted_bytes += int(obj.get("Size", 0))
        print(f"Deleted R2 object: {obj['Key']}")

    print(
        f"[r2-cleanup] scanned={len(objects)} deleted={deleted} "
        f"deleted_bytes={deleted_bytes} total_bytes={total_bytes} "
        f"retention_hours={RETENTION_HOURS} max_storage_bytes={MAX_STORAGE_BYTES}"
    )

    if total_bytes > MAX_STORAGE_BYTES and deleted == 0:
        raise RuntimeError("R2 storage safety limit exceeded and no object could be deleted.")


if __name__ == "__main__":
    main()
