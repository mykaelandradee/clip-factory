import { NextResponse } from "next/server";
import { logEvent, logError } from "./lib/observability";

export function register() {
  logEvent("server_started", {
    nodeEnv: process.env.NODE_ENV,
    generationOnly: process.env.CLIP_FACTORY_GENERATION_ONLY === "true",
  });
}

export async function middleware(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const response = NextResponse.next();
  const durationMs = Date.now() - startedAt;

  if (url.pathname.startsWith("/api/")) {
    logEvent("api_request", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs,
    });
  }

  return response;
}
