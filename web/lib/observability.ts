export type LogContext = Record<string, string | number | boolean | null | undefined>;

// Bloqueia qualquer chave que pareça carregar credenciais, independentemente de
// maiúsculas/minúsculas ou do formato (camelCase, snake_case, kebab-case).
const SENSITIVE_KEY = /(authorization|auth[_-]?header|token|cookie|password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?key|credential|signature|session)/i;

// Mascara valores que se parecem com credenciais mesmo em chaves "inocentes".
const SENSITIVE_VALUE = /(Bearer\s+[A-Za-z0-9._~+/=-]+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

export function redactValue(value: string) {
  return value.replace(SENSITIVE_VALUE, "[REDACTED]");
}

export function sanitizeContext(context: LogContext) {
  return Object.fromEntries(
    Object.entries(context)
      .filter(([key, value]) => !SENSITIVE_KEY.test(key) && value !== undefined)
      .map(([key, value]) => [key, typeof value === "string" ? redactValue(value) : value]),
  );
}

export function logEvent(event: string, context: LogContext = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "clip-factory-web",
    event,
    ...sanitizeContext(context),
  }));
}

export function logError(event: string, error: unknown, context: LogContext = {}) {
  const details = error instanceof Error
    ? { error: redactValue(error.message), errorName: error.name }
    : { error: redactValue(String(error)) };
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "clip-factory-web",
    level: "error",
    event,
    ...sanitizeContext(context),
    ...details,
  }));
}
