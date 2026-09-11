import { z } from "zod";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { fsql } from "@/lib/finshield/db";
import { createClaimExtractor } from "@/lib/finshield/agents/model-adapter";
import { FileInputAccessError, FileInputConflictError, processFileInput } from "@/lib/finshield/files/process";
import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";
import { fileErrorMessage } from "@/lib/finshield/files/file-messages";
import { jsonNoStore, readJson } from "@/lib/ops/http";

export const runtime="nodejs";
export const maxDuration=90;
const schema=z.object({case_id:z.uuid(),input_id:z.uuid(),ocr_consent:z.boolean()});

export async function POST(request:Request) {
  let ownerId:string;
  try {ownerId=await resolveOwner(request);}catch(e){if(e instanceof UnauthenticatedError)return jsonNoStore({error:e.message},401);throw e;}
  const raw=await readJson(request), body=schema.safeParse(raw.ok?raw.value:null);
  if(!body.success)return jsonNoStore({error:"파일 처리 요청 형식이 올바르지 않습니다."},400);
  const sql=fsql(); const {case_id:caseId,input_id:inputId,ocr_consent:ocrConsent}=body.data;
  try {
    const result=await processFileInput({sql,ownerId,caseId,inputId,ocrConsent,extractClaims:createClaimExtractor(),
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(80000)])});
    return jsonNoStore(result,200);
  }catch(error){
    if(error instanceof FileInputAccessError)return jsonNoStore({error:"처리 가능한 본인 파일을 찾을 수 없습니다."},404);
    if(error instanceof FileInputConflictError)return jsonNoStore({error:"이미 처리 중이거나 종료된 파일입니다. 내 기록에서 상태를 확인해 주세요."},409);
    // 실패한 입력도 원본을 방치하지 않는다. 물리 삭제 실패는 DB 작업에 남아 재시도한다.
    await sql`select private.stop_case_input(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,'FILE_PROCESS_FAILED')`.catch(()=>undefined);
    await cleanupCaseFiles(sql,ownerId,caseId).catch(()=>undefined);
    return jsonNoStore({error:fileErrorMessage(error)},422);
  }
}
