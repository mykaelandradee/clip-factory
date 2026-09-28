import { logEvent } from "./lib/observability";

export function register() {
  logEvent("server_started", {
    nodeEnv: process.env.NODE_ENV,
    generationOnly: process.env.CLIP_FACTORY_GENERATION_ONLY === "true",
  });
}
