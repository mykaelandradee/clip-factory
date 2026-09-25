from __future__ import annotations

import os
import time

import boto3
from botocore.config import Config

RETENTION_HOURS = 72
MAX_DELETE_PER_RUN = 500


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

    deleted = 0
    scanned = 0
    continuation_token = None

    while True:
        kwargs = {"Bucket": bucket, "Prefix": "jobs/"}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**kwargs)

        for obj in response.get("Contents", []):
            scanned += 1
            key = obj.get("Key", "")
            if not key.endswith(".mp4"):
                continue
            if job_id and key.startswith(f"jobs/{job_id}/"):
                continue

            modified = obj.get("LastModified")
            if modified is None or modified.timestamp() >= cutoff:
                continue

            client.delete_object(Bucket=bucket, Key=key)
            deleted += 1
            print(f"Deleted expired R2 object: {key}")
            if deleted >= MAX_DELETE_PER_RUN:
                print(f"Reached cleanup safety limit of {MAX_DELETE_PER_RUN} objects.")
                print(f"[r2-cleanup] scanned={scanned} deleted={deleted} retention_hours={RETENTION_HOURS}")
                return

        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    print(f"[r2-cleanup] scanned={scanned} deleted={deleted} retention_hours={RETENTION_HOURS}")


if __name__ == "__main__":
    main()
