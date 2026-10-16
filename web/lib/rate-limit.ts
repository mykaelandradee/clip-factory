import { isIP } from "node:net";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

/**
 * IP do cliente para o rate limit.
 *
 * O Render fica atrás do Cloudflare, que sobrescreve `cf-connecting-ip` e
 * `true-client-ip` com o IP real da conexão: o cliente não consegue forjá-los.
 * `x-forwarded-for` fica como último recurso. Valores que não são IPs válidos
 * são ignorados, para que não virem chaves arbitrárias.
 */
export function getClientIp(request: Request) {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("true-client-ip"),
    request.headers.get("x-forwarded-for")?.split(",")[0],
    request.headers.get("x-real-ip"),
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value)) return value;
  }
  return "unknown";
}

export function getClientKey(request: Request, userId?: string | null) {
  if (userId) return `user:${userId}`;
  return `ip:${getClientIp(request)}`;
}

// Mantém o mapa com tamanho fixo: primeiro remove os expirados e, se ainda
// estiver cheio, descarta os mais antigos (o Map preserva a ordem de inserção).
// Sem isso, chaves forjadas poderiam crescer o mapa até esgotar a memória.
function makeRoom(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  for (const key of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    if (current) buckets.delete(key);
    makeRoom(now);
    const bucket = { count: 1, resetAt: now + windowMs };
    buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  current.count += 1;
  const allowed = current.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

/** Apenas para testes. */
export function __bucketCountForTests() {
  return buckets.size;
}
