import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { decryptInstagramAccessToken, encryptInstagramAccessToken, refreshInstagramLongLivedToken } from "../../../../lib/instagram-auth";
import { deleteR2Clip, getR2PublicClipUrl } from "../../../../lib/r2";

export const runtime = "nodejs";
export const maxDuration = 300;

const INSTAGRAM_API_VERSION = "v25.0";
const INSTAGRAM_GRAPH = `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`;

function configured() {
  return Boolean(
    process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY &&
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_URL &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
  );
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export async function POST(request: Request) {
  if (!configured()) {
    return NextResponse.json({ error: "A publicação do Instagram ainda não está configurada." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Entre no Clip Factory antes de publicar." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  const file = typeof body?.file === "string" ? body.file : "";
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";

  if (!jobId || !/^clip-\d{2}\.mp4$/.test(file) || !caption) {
    return NextResponse.json({ error: "jobId, file e caption são obrigatórios." }, { status: 400 });
  }
  if (caption.length > 2200) {
    return NextResponse.json({ error: "A legenda do Instagram pode ter no máximo 2.200 caracteres." }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ data: connection }, { data: ownedJob }] = await Promise.all([
    admin
      .from("instagram_connections")
      .select("instagram_user_id, access_token_encrypted, expires_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    admin
      .from("clip_jobs")
      .select("id")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!connection) {
    return NextResponse.json({ error: "Conecte sua conta do Instagram antes de publicar." }, { status: 401 });
  }
  if (!ownedJob) {
    return NextResponse.json({ error: "Este processamento não pertence ao usuário autenticado." }, { status: 403 });
  }

  try {
    let accessToken = decryptInstagramAccessToken(connection.access_token_encrypted);
    if (!accessToken) {
      return NextResponse.json({ error: "Não foi possível descriptografar o token do Instagram. Conecte a conta novamente." }, { status: 401 });
    }

    if (connection.expires_at) {
      const expiresAt = Date.parse(connection.expires_at);
      if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
        return NextResponse.json({
          error: "A sessão do Instagram expirou. Conecte o Instagram novamente.",
        }, { status: 401 });
      }

      const refreshWindow = 7 * 24 * 60 * 60 * 1000;
      if (!Number.isNaN(expiresAt) && expiresAt - Date.now() <= refreshWindow) {
        try {
          const refreshed = await refreshInstagramLongLivedToken(accessToken);
          accessToken = refreshed.accessToken;
          const newExpiresAt = refreshed.expiresIn > 0
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : connection.expires_at;

          const { error: refreshSaveError } = await admin
            .from("instagram_connections")
            .update({
              access_token_encrypted: encryptInstagramAccessToken(accessToken),
              expires_at: newExpiresAt,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user.id);

          if (refreshSaveError) {
            console.error("Instagram refreshed token save failed:", refreshSaveError.message);
          }
        } catch (refreshError) {
          console.error("Instagram token refresh failed:", refreshError);
          return NextResponse.json({
            error: "A sessão do Instagram está próxima de expirar e não pôde ser renovada. Conecte o Instagram novamente.",
          }, { status: 401 });
        }
      }
    }

    const videoUrl = getR2PublicClipUrl(jobId, file);

    // Validate the public object before asking Meta to fetch it.
    const mediaCheck = await fetch(videoUrl, { method: "HEAD", cache: "no-store" });
    const contentType = mediaCheck.headers.get("content-type") || "";
    const contentLength = Number(mediaCheck.headers.get("content-length") || "0");
    if (!mediaCheck.ok || !contentType.toLowerCase().startsWith("video/")) {
      console.error("Instagram R2 media check failed:", {
        status: mediaCheck.status,
        contentType,
        contentLength,
        videoUrl,
      });
      return NextResponse.json({
        error: "O vídeo temporário não está publicamente acessível no R2 para o Instagram.",
      }, { status: 502 });
    }

    // Instagram fetches the rendered MP4 directly from the public R2 URL.
    const containerResponse = await fetch(
      `${INSTAGRAM_GRAPH}/me/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "REELS",
          video_url: videoUrl,
          caption,
          share_to_feed: "false",
          access_token: accessToken,
        }),
        cache: "no-store",
      },
    );

    const containerData = await readJson(containerResponse);
    if (!containerResponse.ok || !containerData.id) {
      console.error("Instagram container creation failed:", containerData);
      if (String(containerData?.error?.code || "") === "190") {
        return NextResponse.json({
          error: "A sessão do Instagram expirou ou foi invalidada. Conecte o Instagram novamente.",
        }, { status: 401 });
      }
      return NextResponse.json({
        error: containerData?.error?.message
          ? containerData.error.message + (containerData.error.code ? ` [código ${String(containerData.error.code)}]` : "") + (containerData.error.type ? ` [${String(containerData.error.type)}]` : "") + (containerData.error.fbtrace_id ? ` (Meta fbtrace_id: ${String(containerData.error.fbtrace_id)})` : "")
          : "O Instagram não conseguiu criar o processamento do Reel.",
      }, { status: 502 });
    }

    const creationId = String(containerData.id);
    let statusCode = "";
    let statusText = "";

    for (let attempt = 0; attempt < 45; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const statusResponse = await fetch(
        `${INSTAGRAM_GRAPH}/${encodeURIComponent(creationId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
        { cache: "no-store" },
      );
      const statusData = await readJson(statusResponse);
      if (!statusResponse.ok) {
        console.error("Instagram container status failed:", statusData);
        if (String(statusData?.error?.code || "") === "190") {
          return NextResponse.json({
            error: "A sessão do Instagram expirou ou foi invalidada. Conecte o Instagram novamente.",
          }, { status: 401 });
        }
        return NextResponse.json({
          error: statusData?.error?.message || "Não foi possível consultar o processamento do Reel no Instagram.",
        }, { status: 502 });
      }

      statusCode = String(statusData.status_code || "");
      statusText = String(statusData.status || "");

      if (statusCode === "FINISHED") break;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        return NextResponse.json({
          error: statusText || `O Instagram não conseguiu processar o Reel (${statusCode}).`,
        }, { status: 502 });
      }
    }

    if (statusCode !== "FINISHED") {
      return NextResponse.json({
        error: "O Instagram demorou demais para processar o Reel. O vídeo continua disponível no R2; tente publicar novamente.",
      }, { status: 504 });
    }

    const publishResponse = await fetch(
      `${INSTAGRAM_GRAPH}/me/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        }),
        cache: "no-store",
      },
    );

    const publishData = await readJson(publishResponse);
    if (!publishResponse.ok || !publishData.id) {
      console.error("Instagram publish failed:", publishData);
      if (String(publishData?.error?.code || "") === "190") {
        return NextResponse.json({
          error: "A sessão do Instagram expirou ou foi invalidada. Conecte o Instagram novamente.",
        }, { status: 401 });
      }
      return NextResponse.json({
        error: publishData?.error?.message || "O Instagram não conseguiu publicar o Reel.",
      }, { status: 502 });
    }

    let cleanupWarning = "";
    try {
      await deleteR2Clip(jobId, file);
    } catch (cleanupError) {
      console.error("R2 cleanup after Instagram publish failed:", cleanupError);
      cleanupWarning = " Publicação concluída, mas o arquivo temporário permaneceu no R2.";
    }

    return NextResponse.json({
      ok: true,
      mediaId: String(publishData.id),
      message: `Reel publicado com sucesso.${cleanupWarning}`,
    });
  } catch (error) {
    console.error("Instagram publish error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Erro ao publicar no Instagram.",
    }, { status: 502 });
  }
}
