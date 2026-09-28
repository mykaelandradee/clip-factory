import { NextResponse } from "next/server";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { logEvent, logError } from "../../../lib/observability";

export const runtime = "nodejs";

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("healthcheck_timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkGithub() {
  const token = process.env.CLIP_FACTORY_GITHUB_TOKEN;
  if (!token) return false;
  const response = await withTimeout(fetch("https://api.github.com/rate_limit", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  }));
  return response.ok;
}

async function checkSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  const response = await withTimeout(fetch(`${url}/rest/v1/?limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  }));
  return response.ok;
}

async function checkR2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return false;

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  await withTimeout(client.send(new HeadBucketCommand({ Bucket: bucket })));
  return true;
}

export async function GET() {
  const generationOnly = process.env.CLIP_FACTORY_GENERATION_ONLY === "true";

  const checks = {
    github: false,
    r2: false,
    supabase: generationOnly,
  };

  const results = await Promise.allSettled([
    checkGithub(),
    checkR2(),
    generationOnly ? Promise.resolve(true) : checkSupabase(),
  ]);

  checks.github = results[0].status === "fulfilled" && results[0].value;
  checks.r2 = results[1].status === "fulfilled" && results[1].value;
  checks.supabase = results[2].status === "fulfilled" && results[2].value;

  const checkNames = ["github", "r2", "supabase"] as const;
  const failures = checkNames.filter((name, index) =>
    results[index].status === "rejected" || checks[name] === false
  );

  if (failures.length) {
    logError(
      "healthcheck_dependency_failed",
      failures.join(","),
      { failures: failures.join(",") }
    );
  }

  const online = checks.github && checks.r2 && checks.supabase;

  logEvent("healthcheck", {
    status: online ? "online" : "degraded",
    github: checks.github,
    r2: checks.r2,
    supabase: checks.supabase,
    failedChecks: failures.join(",") || undefined,
  });

  return NextResponse.json(
    {
      status: online ? "online" : "degraded",
      backend: "github-actions",
      checks,
      failedChecks: failures,
      timestamp: new Date().toISOString(),
    },
    {
      status: online ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
