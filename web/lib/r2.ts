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

  const response = await client.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: `jobs/${jobId}/`,
  }));

  return (response.Contents ?? [])
    .map((object) => object.Key ?? "")
    .filter((key) => /^jobs\/[^/]+\/clip-\d{2}\.mp4$/i.test(key))
    .sort()
    .map((key) => ({
      file: key.split("/").pop() as string,
      url: `${publicUrl}/${key}`,
    }));
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
