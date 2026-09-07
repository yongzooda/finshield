import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {resolveOwner,UnauthenticatedError} from "@/lib/finshield/auth";
import {fsql} from "@/lib/finshield/db";
import {finshieldEnv} from "@/lib/finshield/env";
import {jsonNoStore,readJson} from "@/lib/ops/http";

export const runtime="nodejs";
const schema=z.object({mime:z.enum(["application/pdf","image/png","image/jpeg"]),size:z.number().int().min(1).max(10485760)});
export async function POST(request:Request) {
  try {
    const owner=await resolveOwner(request);
    const parsed=await readJson(request);const body=schema.safeParse(parsed.ok?parsed.value:null);
    if(!body.success)return jsonNoStore({error:"PDF·PNG·JPG 파일을 10 MiB 이내로 올려 주세요."},400);
    const env=finshieldEnv();
    if(!env.SUPABASE_SECRET_KEY || !process.env.FINSHIELD_PARSER_SNAPSHOT_ID) {
      return jsonNoStore({error:"파일 처리 연결을 준비 중입니다. 텍스트로 입력해 주세요."},503);
    }
    const slot=await fsql().begin(async sql=>{
      const requestKey=randomUUID();
      const created=await sql`select private.create_case(${owner}::uuid,'LOAN'::public.case_scenario,'파일 권유 검증',
        ${`file-${requestKey}`},${createHash("sha256").update(requestKey).digest("hex")}) as id`;
      const caseId=created[0].id as string;
      const rows=await sql`select * from private.open_upload_slot(${owner}::uuid,${caseId}::uuid,
        ${body.data.mime==='application/pdf'?'PDF':'IMAGE'}::public.case_input_type,${body.data.mime},${body.data.size}::bigint,1,86400)`;
      return {case_id:caseId,input_id:rows[0].case_input_id,object_path:rows[0].object_path,expires_at:rows[0].expires_at};
    });
    return jsonNoStore({...slot,supabase_url:env.SUPABASE_URL,publishable_key:env.SUPABASE_ANON_KEY},200);
  }catch(error){if(error instanceof UnauthenticatedError)return jsonNoStore({error:error.message},401);throw error;}
}
