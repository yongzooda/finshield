import { z } from "zod";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { fsql } from "@/lib/finshield/db";
import { createClaimExtractor } from "@/lib/finshield/agents/model-adapter";
import { processFileInput } from "@/lib/finshield/files/process";
import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";
import { jsonNoStore, readJson } from "@/lib/ops/http";

export const runtime="nodejs";
export const maxDuration=60;
const schema=z.object({case_id:z.uuid(),input_id:z.uuid(),ocr_consent:z.boolean()});
const errors:Record<string,string>={
  OCR_CONSENT_REQUIRED:"이미지나 스캔 PDF는 별도 OCR 동의가 필요합니다. 동의하지 않으려면 내용을 텍스트로 입력해 주세요.",
  OCR_UNAVAILABLE:"OCR 연결이 아직 준비되지 않았습니다. 내용을 텍스트로 입력해 주세요.",
  OCR_BUSY:"문서 인식 요청이 몰려 있습니다. 잠시 후 다시 올려 주세요.",
  PII_RESIDUAL:"개인정보를 안전하게 가리지 못했습니다. 이름·연락처·계좌번호를 제거한 뒤 다시 입력해 주세요.",
  CLAIM_PAGE_AMBIGUOUS:"항목의 원문 위치를 정확히 구분하지 못했습니다. 해당 구절을 텍스트로 입력해 주세요.",
  FILE_REJECTED:"지원하지 않거나 안전하게 읽을 수 없는 파일입니다. PDF·PNG·JPG 형식을 확인해 주세요.",
};
export async function POST(request:Request) {
  let ownerId:string;
  try {ownerId=await resolveOwner(request);}catch(e){if(e instanceof UnauthenticatedError)return jsonNoStore({error:e.message},401);throw e;}
  const raw=await readJson(request), body=schema.safeParse(raw.ok?raw.value:null);
  if(!body.success)return jsonNoStore({error:"파일 처리 요청 형식이 올바르지 않습니다."},400);
  const sql=fsql(); const {case_id:caseId,input_id:inputId,ocr_consent:ocrConsent}=body.data;
  try {
    const result=await processFileInput({sql,ownerId,caseId,inputId,ocrConsent,extractClaims:createClaimExtractor(),
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(50000)])});
    return jsonNoStore(result,200);
  }catch(error){
    const code=String((error as {code?:string}).code??"");
    if(code==="42501")return jsonNoStore({error:"처리 가능한 본인 파일을 찾을 수 없습니다."},404);
    if(code==="23514")return jsonNoStore({error:"이미 처리 중이거나 종료된 파일입니다. 내 기록에서 상태를 확인해 주세요."},409);
    // 실패한 입력도 원본을 방치하지 않는다. 물리 삭제 실패는 DB 작업에 남아 재시도한다.
    await sql`select private.stop_case_input(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,'FILE_PROCESS_FAILED')`.catch(()=>undefined);
    await cleanupCaseFiles(sql,ownerId,caseId).catch(()=>undefined);
    return jsonNoStore({error:errors[(error as Error).message]??"파일 내용을 끝까지 읽지 못했습니다. 파일을 다시 올리거나 텍스트로 입력해 주세요."},422);
  }
}
