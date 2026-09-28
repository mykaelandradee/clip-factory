import os
from datetime import datetime, timedelta, timezone

import boto3

ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
BUCKET = os.environ["R2_BUCKET_NAME"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]

RETENTION_HOURS = int(os.getenv("R2_RETENTION_HOURS", "72"))
MAX_DELETE_PER_RUN = int(os.getenv("R2_MAX_DELETE_PER_RUN", "500"))
MAX_STORAGE_BYTES = int(os.getenv("R2_MAX_STORAGE_BYTES", str(8 * 1024 * 1024 * 1024)))

client = boto3.client(
    "s3",
    endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="auto",
)

objects = []
paginator = client.get_paginator("list_objects_v2")
for page in paginator.paginate(Bucket=BUCKET, Prefix="jobs/"):
    for item in page.get("Contents", []):
        key = item.get("Key", "")
        if key.lower().endswith(".mp4") and key.startswith("jobs/"):
            objects.append(item)

now = datetime.now(timezone.utc)
cutoff = now - timedelta(hours=RETENTION_HOURS)
total_bytes = sum(int(item.get("Size", 0)) for item in objects)

candidates = [
    item for item in objects
    if item.get("LastModified") and item["LastModified"] < cutoff
]

# If the bucket exceeds the safety threshold, remove the oldest remaining
# clips as well, but never more than MAX_DELETE_PER_RUN objects per run.
if total_bytes > MAX_STORAGE_BYTES:
    existing_keys = {item["Key"] for item in candidates}
    for item in sorted(objects, key=lambda value: value.get("LastModified", now)):
        if item["Key"] not in existing_keys:
            candidates.append(item)
            existing_keys.add(item["Key"])

candidates = sorted(candidates, key=lambda value: value.get("LastModified", now))
selected = candidates[:MAX_DELETE_PER_RUN]

deleted_bytes = 0
for item in selected:
    client.delete_object(Bucket=BUCKET, Key=item["Key"])
    deleted_bytes += int(item.get("Size", 0))

print(f"R2 cleanup: scanned={len(objects)} total_bytes={total_bytes} "
      f"candidates={len(candidates)} deleted={len(selected)} "
      f"deleted_bytes={deleted_bytes} retention_hours={RETENTION_HOURS}")

if total_bytes > MAX_STORAGE_BYTES and not selected:
    raise RuntimeError("R2 storage limit exceeded but no objects were eligible for deletion.")
