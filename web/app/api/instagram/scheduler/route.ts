import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  const secret = process.env.CLIP_FACTORY_SCHEDULER_TOKEN || "";
  const supplied = request.headers.get("x-clip-factory-scheduler-token") || "";
  if (!secret || supplied !== secret) return NextResponse.json({ error: "Não autorizado." }, { status: 401, headers: noStore });

  const admin = createAdminClient();
  const { data: due, error } = await admin.from("instagram_scheduled_posts").select("id").eq("status","scheduled").lte("scheduled_at",new Date().toISOString()).order("scheduled_at",{ascending:true}).limit(10);
  if (error) {
    console.error("Instagram scheduler lookup failed:", error.message);
    return NextResponse.json({ error: "Não foi possível consultar os agendamentos." }, { status: 500, headers: noStore });
  }

  const origin = (process.env.CLIP_FACTORY_WEB_URL || new URL(request.url).origin).replace(/\/$/,"");
  const results:Array<{id:string;status:string;error?:string}> = [];

  for (const item of due || []) {
    const { data: claimed } = await admin.from("instagram_scheduled_posts").update({status:"processing",attempts:1,updated_at:new Date().toISOString()}).eq("id",item.id).eq("status","scheduled").select("id").maybeSingle();
    if (!claimed) continue;

    try {
      const response = await fetch(origin + "/api/instagram/publish", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-clip-factory-scheduler-token":secret},
        body:JSON.stringify({scheduledPostId:item.id}),
        cache:"no-store"
      });
      const data=await response.json().catch(()=>({}));
      if (!response.ok) {
        const message=String(data?.error||"Falha na publicação.");
        await admin.from("instagram_scheduled_posts").update({status:"failed",last_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("id",item.id).eq("status","processing");
        results.push({id:item.id,status:"failed",error:message});
      } else {
        results.push({id:item.id,status:"published"});
      }
    } catch(error) {
      const message=error instanceof Error?error.message:"Falha na publicação.";
      await admin.from("instagram_scheduled_posts").update({status:"failed",last_error:message.slice(0,1000),updated_at:new Date().toISOString()}).eq("id",item.id).eq("status","processing");
      results.push({id:item.id,status:"failed",error:message});
    }
  }

}

export async function GET(request:Request) { return POST(request); }
