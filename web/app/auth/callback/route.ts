import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { safeRedirectPath } from "../../../lib/security";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/?auth_error=missing_code", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Supabase auth callback failed:", error.message);
    return NextResponse.redirect(new URL("/?auth_error=callback_failed", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
