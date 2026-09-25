import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
    throw new Error("Cloudflare R2 não está configurado na Vercel.");
  }

  return { accountId, bucket, accessKeyId, secretAccessKey, publicUrl };
}

export function getR2PublicClipUrl(jobId: string, file: string) {
  const { publicUrl } = getR2Config();
  return `${publicUrl}/jobs/${jobId}/${file}`;
}

export async function listR2ClipUrls(jobId: string) {
  const { accountId, bucket, accessKeyId, secretAccessKey, publicUrl } = getR2Config();
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `jobs/${jobId}/`,
    }));

    const files = (response.Contents ?? [])
      .map((object) => object.Key ?? "")
      .filter((key) => /^jobs\/[^/]+\/clip-\d{2}\.mp4$/i.test(key))
      .sort()
      .map((key) => ({
        file: key.split("/").pop() as string,
        url: `${publicUrl}/${key}`,
      }));

    if (files.length > 0) return files;
  } catch (error) {
    console.error("R2 object listing failed; using public URL fallback:", error);
  }

  // The worker uses deterministic keys. This fallback does not require
  // ListObjects permission and works even if bucket listing is unavailable.
  const candidates = Array.from({ length: 15 }, (_, index) => {
    const file = `clip-${String(index + 1).padStart(2, "0")}.mp4`;
    return { file, url: `${publicUrl}/jobs/${jobId}/${file}` };
  });

  const verified = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const response = await fetch(candidate.url, {
          method: "HEAD",
          cache: "no-store",
        });
        return response.ok ? candidate : null;
      } catch {
        return null;
      }
    }),
  );

  return verified.filter((item): item is { file: string; url: string } => item !== null);
}

export async function deleteR2Clip(jobId: string, file: string) {
  const { accountId, bucket, accessKeyId, secretAccessKey } = getR2Config();
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  await client.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: `jobs/${jobId}/${file}`,
  }));
}
