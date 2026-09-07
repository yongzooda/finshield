import { start } from "workflow/api";
import { fileExpiryWorkflow } from "@/lib/finshield/workflows/file-expiry";
import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";
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
    if(process.env.FINSHIELD_FILE_GATEWAY_ENABLED !== "true" || !env.SUPABASE_SECRET_KEY || !process.env.FINSHIELD_PARSER_SNAPSHOT_ID) {
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
    try { await start(fileExpiryWorkflow, [slot.input_id as string]); }
    catch {
      // 삭제 예약이 확인되지 않으면 경로를 전달하지 않아 업로드가 시작되지 않게 한다.
      const sql=fsql();
      await sql`select private.stop_case_input(${owner}::uuid,${slot.case_id}::uuid,${slot.input_id}::uuid,'EXPIRY_DISPATCH_FAILED')`;
      await cleanupCaseFiles(sql,owner,slot.case_id).catch(()=>undefined);
      return jsonNoStore({error:"파일 정리 예약을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."},503);
    }
    return jsonNoStore({...slot,supabase_url:env.SUPABASE_URL,publishable_key:env.SUPABASE_ANON_KEY},200);
  }catch(error){
    if(error instanceof UnauthenticatedError)return jsonNoStore({error:error.message},401);
    if(error instanceof Error && error.message === "ACCOUNT_DELETING") {
      return jsonNoStore({code:"ACCOUNT_DELETING",error:"계정 삭제가 진행 중입니다. 개인정보 관리 화면에서 진행 상태를 확인해 주세요."},409);
    }
    throw error;
  }
}
