import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type postgres from "postgres";
import { gateForModel } from "@/lib/agents/pii";
import type { ClaimExtractor } from "../intake";
import { PII_POLICY_VERSION } from "../intake";
import { parseIsolatedFile, type ParsedPage } from "./parser";
import { readQuarantinedFile } from "./storage";
import { extractWithOcr } from "./ocr";

type Sql = ReturnType<typeof postgres>;
const hash = (text:string) => createHash("sha256").update(text).digest("hex");

/** 마스킹한 페이지의 구절을 실제 위치로 연결한다. 모델의 좌표나 페이지 번호는 받지 않는다. */
export function locateFileQuote(pages: Pick<ParsedPage,"page_no"|"text">[], quote: string) {
  const matches = pages.flatMap(page => {
    const start = page.text.indexOf(quote);
    if (start >= 0 && page.text.indexOf(quote,start+1) >= 0) throw new Error("CLAIM_PAGE_AMBIGUOUS");
    return start < 0 ? [] : [{schema_version:"v1",kind:"masked_text_span",page_no:page.page_no,start,end:start+quote.length}];
  });
  if (matches.length !== 1) throw new Error("CLAIM_PAGE_AMBIGUOUS");
  return matches[0];
}

/** INP-013: 원본은 검사·동의 경계 안에서만 사용하고 마스킹한 텍스트만 모델·영속 DB로 보낸다. */
export async function processFileInput(args: {sql:Sql;ownerId:string;caseId:string;inputId:string;
  ocrConsent:boolean;extractClaims:ClaimExtractor;signal?:AbortSignal}) {
  const {sql,ownerId,caseId,inputId}=args;
  const signal=AbortSignal.any([AbortSignal.timeout(35000),...(args.signal?[args.signal]:[])]);
  const [row]=await sql`select private.file_input_context(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid) as context`;
  const file=row.context as {object_id:string;object_path:string;declared_mime:string;size_bytes:number};
  // 선택 결과를 원본 확인 전에 입력에 고정한다. native PDF에는 외부 전송을 하지 않는다.
  await sql`select private.record_file_ocr_consent(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,${args.ocrConsent})`;
  const bytes=await readQuarantinedFile(file.object_path,Number(file.size_bytes),signal);
  const parsed=await parseIsolatedFile(bytes,file.declared_mime,file.declared_mime==="application/pdf"?"input.pdf":file.declared_mime==="image/png"?"input.png":"input.jpg",signal);
  signal.throwIfAborted();
  const magic=bytes.subarray(0,8).toString("hex");
  await sql.begin(async tx => {
    // OPEN은 한 번만 소비한다. 중복 요청은 OCR 호출에 도달하기 전에 여기서 거부된다.
    await tx`select id from private.confirm_upload_slot(${file.object_id}::uuid,${magic})`;
    await tx`select id from private.advance_input_stage(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,
      'VALIDATED',${JSON.stringify({detected_mime:parsed.mime,magic_signature:magic})}::text::jsonb)`;
  });
  let pages=parsed.pages;
  if (parsed.needs_ocr) {
    if (!args.ocrConsent) throw new Error("OCR_CONSENT_REQUIRED");
    if (!process.env.CLOVA_OCR_SECRET || !process.env.CLOVA_OCR_INVOKE_URL) throw new Error("OCR_UNAVAILABLE");
    const [slot]=await sql`select * from private.acquire_provider_slot('clova','ocr-general',1000)`;
    const wait=Math.max(0,Date.parse(slot.scheduled_at)-Date.now());
    if(wait>5000)throw new Error("OCR_BUSY");
    if(wait)await delay(wait,undefined,{signal});
    pages=await extractWithOcr({bytes,mime:parsed.mime,pageCount:pages.length,signal,
      authorize:async()=>{const [r]=await sql`select private.authorize_file_ocr(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid) as allowed`;return r.allowed===true;}});
  }
  const pageIds=await sql.begin(async tx=>{
    await tx`select private.register_input_pages(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,${pages.length},'SUCCEEDED','v1')`;
    const ids=await tx`select * from private.input_page_ids(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid)`;
    if(parsed.needs_ocr) for(const page of ids) {
      const [artifact]=await tx`select private.register_ocr_artifact(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,${page.id}::uuid,'CLOVA',null,3600) as id`;
      await tx`select private.enqueue_file_cleanup('OCR_ARTIFACT',${artifact.id}::uuid,'MASKING_COMPLETED')`;
    }
    return ids;
  });
  const maskedPages=pages.map(page=>{
    const gate=gateForModel(page.text);
    if(!gate.ok)throw new Error("PII_RESIDUAL");
    return {page_no:page.page_no,text:gate.masked.text};
  });
  const maskedText=maskedPages.map(page=>page.text).join("\n\n");
  // 더 이상 사용하지 않는 원본 Buffer와 페이지 참조를 모델 호출 전에 해제한다.
  bytes.fill(0);
  for(const page of pages) { page.text=""; page.words=[]; }
  if (!maskedText.trim()) throw new Error("FILE_TEXT_EMPTY");
  signal.throwIfAborted();
  await sql.begin(async tx=>{
    await tx`select id from private.advance_input_stage(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,'EXTRACTED','{}')`;
    await tx`select id from private.advance_input_stage(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,'MASKED',
      ${JSON.stringify({masked_text:maskedText,masked_text_hash:hash(maskedText),pii_policy_version:PII_POLICY_VERSION})}::text::jsonb)`;
  });
  const extracted=await args.extractClaims(maskedText,{signal,budget:{sql,ownerId,caseId,inputId}});
  const located=extracted.map(claim=>{
    const gate=gateForModel(claim.statementMasked);
    if(!gate.ok)throw new Error("PII_RESIDUAL");
    if(!claim.sourceQuote)throw new Error("CLAIM_SOURCE_NOT_FOUND");
    return {...claim,statementMasked:gate.masked.text,locator:locateFileQuote(maskedPages,claim.sourceQuote)};
  });
  if(!located.length)throw new Error("CLAIMS_NOT_FOUND");
  signal.throwIfAborted();
  const claims=await sql.begin(async tx=>{
    const results=[];
    for(const [index,claim] of located.entries()) {
      const pageId=pageIds.find(page=>page.page_no===claim.locator.page_no)?.id;
      const [saved]=await tx`select private.record_file_claim(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,${pageId}::uuid,
        ${claim.claimType},${claim.statementMasked},${claim.materiality},${JSON.stringify(claim.locator)}::text::jsonb) as id`;
      results.push({claim_id:saved.id,claim_ref:`C${index+1}`,claim_type:claim.claimType,statement_masked:claim.statementMasked,
        materiality:claim.materiality,expected_revision_no:1,source_page_no:claim.locator.page_no});
    }
    return results;
  });
  return {case_id:caseId,input_id:inputId,claims,masked_pages:maskedPages,masked_text:maskedText};
}
