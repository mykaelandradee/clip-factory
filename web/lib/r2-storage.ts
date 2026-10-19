// Operações de armazenamento no R2 usadas pelo Influencer Manager.

export const R2_STORAGE_LIMIT_BYTES = 8 * 1024 * 1024 * 1024; // mesmo limite interno do worker

type S3Client = import("@aws-sdk/client-s3").S3Client;

async function getClient(): Promise<{ client: S3Client; bucket: string } | null> {
  const accountId = process.env.R2_ACCOUNT_ID, bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  const { S3Client } = await import("@aws-sdk/client-s3");
  return {
    client: new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } }),
    bucket,
  };
}

/** Lista as chaves e o tamanho total sob um prefixo (ou do bucket inteiro). */
export async function listObjects(prefix = "") {
  const r2 = await getClient();
  if (!r2) return null;
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const keys: string[] = [];
  let bytes = 0;
  let token: string | undefined;
  do {
    const page = await r2.client.send(new ListObjectsV2Command({ Bucket: r2.bucket, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const object of page.Contents || []) {
      if (object.Key) keys.push(object.Key);
      bytes += Number(object.Size || 0);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { keys, bytes };
}

/** Apaga as chaves informadas (em lotes de 1000, o máximo do S3). */
export async function deleteKeys(keys: string[]) {
  const r2 = await getClient();
  if (!r2 || !keys.length) return 0;
  const { DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await r2.client.send(new DeleteObjectsCommand({ Bucket: r2.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
  return keys.length;
}

/**
 * Apaga tudo sob o prefixo de um vídeo (vídeo, cortes, manifesto, erro).
 * O prefixo precisa ser a pasta de um item do usuário, para nunca apagar
 * arquivos de outra pasta por engano.
 */
export async function deleteItemFolder(prefix: string) {
  if (!/^influencer\/[^/]+\/libraries\/[^/]+\/[0-9a-f-]{36}$/i.test(prefix)) throw new Error("Prefixo de item inválido.");
  const listed = await listObjects(prefix + "/");
  return listed ? deleteKeys(listed.keys) : 0;
}

export function itemFolder(userId: string, libraryId: string, itemId: string) {
  return `influencer/${userId}/libraries/${libraryId}/${itemId}`;
}
