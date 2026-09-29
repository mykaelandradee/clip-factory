import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "../../../../lib/supabase/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { getR2PublicClipUrl } from "../../../../lib/r2";
import { getClientKey, rateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
const FILE_PATTERN = /^clip-(?:0[1-9]|1[0-5])\.mp4$/i;
const validUuid = (v:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function isAnonymousJobAccessValid(jobId:string, token:string|null) {
 if(!token)return false;
 const secret=process.env.CLIP_FACTORY_TOKEN_ENCRYPTION_KEY||process.env.CLIP_FACTORY_WORKER_TOKEN||process.env.CLIP_FACTORY_GITHUB_TOKEN||"";
 if(!secret)return false;
 try {
  const expected=createHmac("sha256",secret).update("clip-factory-anonymous-job:"+jobId).digest("base64url");
  const a=Buffer.from(expected), b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
 } catch { return false; }
}

export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};
 if(Number(request.headers.get("content-length")||0)>MAX_BODY_BYTES)return NextResponse.json({error:"Requisição muito grande."},{status:413,headers});
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Entre no Clip Factory antes de agendar."},{status:401,headers});
 const rate=rateLimit(getClientKey(request),20,3600000);
 if(!rate.allowed)return NextResponse.json({error:"Muitos agendamentos em pouco tempo."},{status:429,headers:{...headers,"Retry-After":String(rate.retryAfterSeconds)}});
 const body=await request.json().catch(()=>null);
 const jobId=typeof body?.jobId==="string"?body.jobId:"", accessToken=typeof body?.accessToken==="string"?body.accessToken:null, file=typeof body?.file==="string"?body.file:"", caption=typeof body?.caption==="string"?body.caption.trim():"", scheduledAt=typeof body?.scheduledAt==="string"?body.scheduledAt:"";
 if(!validUuid(jobId)||!FILE_PATTERN.test(file)||!caption||!scheduledAt)return NextResponse.json({error:"jobId, file, caption e scheduledAt são obrigatórios."},{status:400,headers});
 if(caption.length>2200)return NextResponse.json({error:"A legenda do Instagram pode ter no máximo 2.200 caracteres."},{status:400,headers});
 const date=new Date(scheduledAt);
 if(Number.isNaN(date.getTime())||date.getTime()<Date.now()+60000)return NextResponse.json({error:"Agende pelo menos 1 minuto no futuro."},{status:400,headers});
 const admin=createAdminClient();
 const [{data:connection},{data:job}]=await Promise.all([
  admin.from("instagram_connections").select("user_id").eq("user_id",user.id).maybeSingle(),
  admin.from("clip_jobs").select("id,user_id").eq("id",jobId).maybeSingle()
 ]);
 if(!connection)return NextResponse.json({error:"Conecte sua conta do Instagram antes de agendar."},{status:401,headers});
 const ownsUserJob=job?.user_id===user.id;
 const ownsAnonymousJob=job?.user_id==null&&isAnonymousJobAccessValid(jobId,accessToken);
 if(!job||(!ownsUserJob&&!ownsAnonymousJob))return NextResponse.json({error:"Este processamento não pertence ao usuário autenticado."},{status:403,headers});
 if(ownsAnonymousJob){
  const {error:claimError}=await admin.from("clip_jobs").update({user_id:user.id}).eq("id",jobId).is("user_id",null);
  if(claimError)return NextResponse.json({error:"Não foi possível vincular este processamento ao usuário autenticado."},{status:500,headers});
 }
 const media=await fetch(getR2PublicClipUrl(jobId,file),{method:"HEAD",cache:"no-store"});
 if(!media.ok||!(media.headers.get("content-type")||"").toLowerCase().startsWith("video/"))return NextResponse.json({error:"O clip não está disponível no R2 para o agendamento."},{status:409,headers});
 const {data,error}=await admin.from("instagram_scheduled_posts").insert({user_id:user.id,job_id:jobId,file,caption,scheduled_at:date.toISOString(),status:"scheduled",attempts:0}).select("id,job_id,file,caption,scheduled_at,status").single();
 if(error){console.error("Instagram schedule creation failed:",{message:error.message,code:error.code,details:error.details,hint:error.hint});return NextResponse.json({error:"Não foi possível criar o agendamento.",detail:error.message,code:error.code||null},{status:500,headers});}
 return NextResponse.json({ok:true,scheduledPost:data},{headers});
}
export async function GET(request:Request){
 const headers={"Cache-Control":"no-store"}; const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Entre no Clip Factory."},{status:401,headers});
 const admin=createAdminClient(); const {data,error}=await admin.from("instagram_scheduled_posts").select("id,job_id,file,caption,scheduled_at,status,attempts,media_id,last_error,created_at,updated_at").eq("user_id",user.id).order("scheduled_at",{ascending:true}).limit(50);
 if(error)return NextResponse.json({error:"Não foi possível carregar os agendamentos."},{status:500,headers});
 return NextResponse.json({scheduledPosts:data||[]},{headers});
}
export async function DELETE(request:Request){
 const headers={"Cache-Control":"no-store"}; const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Entre no Clip Factory."},{status:401,headers});
 const id=new URL(request.url).searchParams.get("id")||""; if(!validUuid(id))return NextResponse.json({error:"ID de agendamento inválido."},{status:400,headers});
 const admin=createAdminClient(); const {data,error}=await admin.from("instagram_scheduled_posts").update({status:"canceled",updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",user.id).eq("status","scheduled").select("id,status").maybeSingle();
 if(error)return NextResponse.json({error:"Não foi possível cancelar o agendamento."},{status:500,headers});
 if(!data)return NextResponse.json({error:"Agendamento não encontrado ou já processado."},{status:409,headers});
 return NextResponse.json({ok:true,scheduledPost:data},{headers});
}