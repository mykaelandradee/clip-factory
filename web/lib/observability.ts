export type LogContext = Record<string, string | number | boolean | null | undefined>;

function sanitizeContext(context: LogContext) {
  const blocked = new Set(["authorization", "accessToken", "token", "cookie", "password", "secret", "key"]);
  return Object.fromEntries(
    Object.entries(context).filter(([key, value]) => !blocked.has(key) && value !== undefined),
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
  const details = error instanceof Error ? { error: error.message, errorName: error.name } : { error: String(error) };
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "clip-factory-web",
    level: "error",
    event,
    ...sanitizeContext(context),
    ...details,
  }));
}
