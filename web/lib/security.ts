import { timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante.
 * Retorna false para valores vazios, ausentes ou de tamanhos diferentes.
 */
export function safeEqual(provided: string | null | undefined, expected: string | null | undefined) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Valida um header `Authorization: Bearer <segredo>` em tempo constante. */
export function hasValidBearer(request: Request, expected: string | null | undefined) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), expected);
}

/**
 * Segredo usado para assinar os tokens de acesso de jobs anônimos.
 * Usa uma chave dedicada quando configurada e nunca reutiliza o token do GitHub.
 */
export function getAnonymousJobSecret() {
  return (
    process.env.CLIP_FACTORY_ANONYMOUS_JOB_SECRET ||
    process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY ||
    process.env.CLIP_FACTORY_WORKER_TOKEN ||
    ""
  );
}

/**
 * Garante que um destino de redirecionamento seja um caminho relativo da própria aplicação.
 * Bloqueia `//host`, `/\host`, esquemas (`javascript:`), caracteres de controle e
 * qualquer valor que, ao ser resolvido, aponte para outra origem.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = "/") {
  if (!value || typeof value !== "string" || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const base = "https://clip-factory.invalid";
    const resolved = new URL(value, base);
    if (resolved.origin !== base) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
