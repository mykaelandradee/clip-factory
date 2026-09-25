import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const checks = {
    github: Boolean(process.env.CLIP_FACTORY_GITHUB_TOKEN),
    r2: Boolean(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_BUCKET_NAME &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_PUBLIC_URL,
    ),
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };

  const online = checks.github && checks.r2 && checks.supabase;

  return NextResponse.json(
    {
      status: online ? "online" : "degraded",
      backend: "github-actions",
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: online ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
