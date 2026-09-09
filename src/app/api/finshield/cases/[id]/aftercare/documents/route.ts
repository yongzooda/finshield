import { z } from "zod";
import { jsonNoStore, readJson } from "@/lib/ops/http";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { restSelect } from "@/lib/finshield/rest";
import { fsql } from "@/lib/finshield/db";
import { gateForModel } from "@/lib/agents/pii";
import { cleanupCaseFiles } from "@/lib/finshield/files/cleanup";

export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
const selection=z.object({input_id:z.uuid(),base_passport_id:z.uuid(),claims:z.array(z.object({
  id:z.uuid(),target_claim_id:z.uuid(),statement_masked:z.string().trim().min(1).max(400),ocr_reviewed:z.boolean().optional(),
})).min(1).max(8)});

/** PC-008: 다시 열면 저장된 문서 항목을 읽으며 원본·모델을 다시 호출하지 않는다. */
export async function GET(request:Request,context:Context) {
  try {
    await resolveOwner(request);const {id}=await context.params;
    if(!z.uuid().safeParse(id).success)return jsonNoStore({error:"잘못된 Case입니다."},400);
    const token=bearerToken(request)!;
    const cases=await restSelect({token,path:"financial_cases",query:{select:"id",id:`eq.${id}`,limit:"1"}});
    if(!cases.length)return jsonNoStore({error:"본인 Case를 찾을 수 없습니다."},404);
    const inputs=z.array(z.object({id:z.uuid()}).passthrough()).parse(await restSelect({token,path:"case_inputs",query:{select:"id,input_stage,input_outcome,raw_delete_status,raw_expires_at",
      case_id:`eq.${id}`,input_purpose:"eq.AFTERCARE",order:"created_at.desc",limit:"20"}}));
    const terms=inputs.length?await restSelect({token,path:"precase_document_terms",query:{
      select:"id,case_input_id,statement_masked,original_statement_masked,source_locator,confirmed,removed,base_passport_id,target_claim_id",
      case_id:`eq.${id}`,case_input_id:`in.(${inputs.map(i=>i.id).join(",")})`,order:"created_at.asc",limit:"160"}}):[];
    return jsonNoStore({inputs,terms});
  } catch(error) {
    if(error instanceof UnauthenticatedError)return jsonNoStore({error:error.message},401);
    return jsonNoStore({error:"문서 처리 기록을 읽지 못했습니다."},503);
  }
}

export async function POST(request:Request,context:Context) {
  try {
    const owner=await resolveOwner(request);const {id}=await context.params;
    if(!z.uuid().safeParse(id).success)return jsonNoStore({error:"잘못된 Case입니다."},400);
    const parsed=await readJson(request),body=selection.safeParse(parsed.ok?parsed.value:null);
    if(!body.success)return jsonNoStore({error:"문서 항목과 연결할 이전 권유를 확인해 주세요."},400);
    const claims=[];
    for(const claim of body.data.claims){const gate=gateForModel(claim.statement_masked);
      if(!gate.ok)return jsonNoStore({error:"문서 문구의 개인정보를 지워 주세요."},400);
      claims.push({...claim,statement_masked:gate.masked.text});}
    await fsql()`select private.confirm_aftercare_document(${owner}::uuid,${id}::uuid,${body.data.input_id}::uuid,
      ${body.data.base_passport_id}::uuid,${JSON.stringify(claims)}::text::jsonb)`;
    await cleanupCaseFiles(fsql(),owner,id).catch(()=>undefined);
    // 삭제 진행 여부는 실제 input 원장을 GET으로 복원한다.
    return jsonNoStore({status:"CONFIRMED",input_id:body.data.input_id});
  } catch(error) {
    if(error instanceof UnauthenticatedError)return jsonNoStore({error:error.message},401);
    const code=String((error as {code?:string}).code??"");
    if((error as Error).message.includes("OCR_REVIEW_REQUIRED"))return jsonNoStore({error:"낮은 신뢰도 문구를 원본과 대조해 주세요."},409);
    if(code==="42501")return jsonNoStore({error:"이 Case의 문서와 기준 Passport를 확인해 주세요."},404);
    if(["23514","55000","40001"].includes(code))return jsonNoStore({error:"이미 확인했거나 처리 중단된 문서입니다. 저장된 상태를 다시 열어 주세요."},409);
    return jsonNoStore({error:"문서 확인 응답을 받지 못했습니다. 같은 항목으로 다시 확인할 수 있습니다."},503);
  }
}
