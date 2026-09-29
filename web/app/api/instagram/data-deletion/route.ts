import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";

function getAppSecret() {
  return process.env.INSTAGRAM_CLIENT_SECRET || process.env.INSTAGRAM_APP_SECRET || "";
}

function parseSignedRequest(value: string | null) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;

  try {
    const decode = (input: string) => Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const encodedSignature = parts[0];
    const payload = JSON.parse(decode(parts[1]));
    const algorithm = String(payload.algorithm || "").toUpperCase();

    if (algorithm !== "HMAC-SHA256") return null;

    const secret = getAppSecret();
    if (!secret) return null;

    const expected = crypto.createHmac("sha256", secret).update(parts[1]).digest();
    const received = Buffer.from(encodedSignature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

    return payload as { user_id?: string; data?: { user_id?: string } };
  } catch {
    return null;
  }
}

async function readSignedRequest(request: Request) {
  if (request.method === "GET") {
    return new URL(request.url).searchParams.get("signed_request");
  }

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const value = form.get("signed_request");
    return typeof value === "string" ? value : null;
  }

  const body = await request.text();
  if (!body) return null;
  try {
    const json = JSON.parse(body);
    return typeof json.signed_request === "string" ? json.signed_request : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  return handleRequest(request);
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("confirmation_code");
  if (code) {
    return NextResponse.json({ status: "completed", confirmation_code: code }, { headers: { "Cache-Control": "no-store" } });
  }
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const signedRequest = await readSignedRequest(request);
  const payload = parseSignedRequest(signedRequest);
  const instagramUserId = String(payload?.user_id || payload?.data?.user_id || "");

  if (!instagramUserId) {
    return NextResponse.json({ error: "Solicitação de exclusão de dados inválida." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("instagram_connections")
    .delete()
    .eq("instagram_user_id", instagramUserId);

  if (error) {
    console.error("Instagram data deletion failed:", error.message);
    return NextResponse.json({ error: "Não foi possível concluir a exclusão dos dados." }, { status: 500 });
  }

  const confirmationCode = crypto.randomUUID();
  const publicUrl = new URL(request.url);
  publicUrl.search = "";
  publicUrl.hash = "";
  publicUrl.searchParams.set("confirmation_code", confirmationCode);

  return NextResponse.json({
    url: publicUrl.toString(),
    confirmation_code: confirmationCode,
  });
}
