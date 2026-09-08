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
import { cleanupCaseFiles } from "./cleanup";
import { lowConfidenceFields, lowConfidenceFieldsForSpan } from "./ocr-review";

export class FileInputAccessError extends Error {
  readonly code = "42501";
  constructor() { super("FILE_INPUT_NOT_ACCESSIBLE"); }
}

export class FileInputConflictError extends Error {
  constructor() { super("FILE_INPUT_CONFLICT"); }
}

type Sql = ReturnType<typeof postgres>;
const hash = (text:string) => createHash("sha256").update(text).digest("hex");

/** 마스킹한 페이지의 구절을 실제 위치로 연결한다. 모델의 좌표나 페이지 번호는 받지 않는다. */
export function locateFileQuote(pages: Pick<ParsedPage,"page_no"|"text">[], quote: string, pageNo?: number) {
  const needle = quote.replace(/\s/g, "");
  if (!needle) throw new Error("CLAIM_SOURCE_NOT_FOUND");
  const matches = pages.filter(page => pageNo === undefined || page.page_no === pageNo).flatMap(page => {
    // 모델이 줄바꿈을 공백으로 바꿔도 좌표는 실제 마스킹 페이지의 문자열 위치로 계산한다.
    const offsets: number[] = []; let normalized = "";
    for (let i=0;i<page.text.length;i++) if (!/\s/.test(page.text[i])) { normalized += page.text[i]; offsets.push(i); }
    const at = normalized.indexOf(needle);
    if (at >= 0 && normalized.indexOf(needle,at+1) >= 0) throw new Error("CLAIM_PAGE_AMBIGUOUS");
    return at < 0 ? [] : [{schema_version:"v1",kind:"masked_text_span",page_no:page.page_no,start:offsets[at],end:offsets[at+needle.length-1]+1}];
  });
  if (matches.length !== 1) throw new Error("CLAIM_PAGE_AMBIGUOUS");
  return matches[0];
}

/** INP-013: 원본은 검사·동의 경계 안에서만 사용하고 마스킹한 텍스트만 모델·영속 DB로 보낸다. */
export async function processFileInput(args: {sql:Sql;ownerId:string;caseId:string;inputId:string;
  ocrConsent:boolean;extractClaims:ClaimExtractor;signal?:AbortSignal}) {
  const {sql,ownerId,caseId,inputId}=args;
  const signal=AbortSignal.any([AbortSignal.timeout(35000),...(args.signal?[args.signal]:[])]);
  const [row]=await sql`select private.file_input_context(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid) as context`.catch(error => {
    if (error.code === "42501") throw new FileInputAccessError();
    throw error;
  });
  const file=row.context as {input_purpose?:string;object_id:string;object_path:string;declared_mime:string;size_bytes:number};
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
  }).catch(error => {
    if (error.code === "23514") throw new FileInputConflictError();
    throw error;
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
  const reviewByPage=new Map<number,ReturnType<typeof lowConfidenceFields>>();
  const ocrArtifactIds: string[] = [];
  const pageIds=await sql.begin(async tx=>{
    await tx`select private.register_input_pages(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,${pages.length},'SUCCEEDED','v1')`;
    const ids=await tx`select * from private.input_page_ids(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid)`;
    if(parsed.needs_ocr) for(const page of ids) {
      const [artifact]=await tx`select private.register_ocr_artifact(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,${page.id}::uuid,'NAVER_CLOVA_OCR',null,3600) as id`;
      ocrArtifactIds.push(artifact.id);
    }
    return ids;
  });
  const maskedPages=pages.map(page=>{
    const gate=gateForModel(page.text);
    if(!gate.ok)throw new Error("PII_RESIDUAL");
    const reviewFields=lowConfidenceFields(page,gate.masked.text);
    reviewByPage.set(page.page_no,reviewFields);
    return {page_no:page.page_no,text:gate.masked.text,
      low_confidence_count:reviewFields.length,low_confidence_fields:reviewFields};
  });
  await sql`select private.record_input_page_review(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,
    ${JSON.stringify(maskedPages)}::text::jsonb)`;
  const maskedText=maskedPages.map(page=>page.text).join("\n\n");
  // 더 이상 사용하지 않는 원본 Buffer와 페이지 참조를 모델 호출 전에 해제한다.
  bytes.fill(0);
  for(const page of pages) { page.text=""; page.words=[]; }
  // OCR은 메모리에서만 처리한다. 원문 참조를 해제한 뒤 기존 부재 확인 계약으로 기록한다.
  for (const artifactId of ocrArtifactIds) {
    await sql`select private.enqueue_file_cleanup('OCR_ARTIFACT',${artifactId}::uuid,'OBJECT_MISSING')`;
  }
  if (ocrArtifactIds.length) await cleanupCaseFiles(sql,ownerId,caseId);
  if (!maskedText.trim()) throw new Error("FILE_TEXT_EMPTY");
  signal.throwIfAborted();
  await sql.begin(async tx=>{
    await tx`select id from private.advance_input_stage(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,'EXTRACTED','{}')`;
    await tx`select id from private.advance_input_stage(${ownerId}::uuid,${caseId}::uuid,${inputId}::uuid,'MASKED',
      ${JSON.stringify({masked_text:maskedText,masked_text_hash:hash(maskedText),pii_policy_version:PII_POLICY_VERSION})}::text::jsonb)`;
  });
  const extracted=await args.extractClaims(maskedText,{signal,pages:maskedPages,budget:{sql,ownerId,caseId,inputId}});
  const located=extracted.map(claim=>{
    const gate=gateForModel(claim.statementMasked);
    if(!gate.ok)throw new Error("PII_RESIDUAL");
    if(!claim.sourceQuote)throw new Error("CLAIM_SOURCE_NOT_FOUND");
    const locator=locateFileQuote(maskedPages,claim.sourceQuote,claim.sourcePageNo);
    const reviewFields=lowConfidenceFieldsForSpan(reviewByPage.get(locator.page_no)??[],locator);
    return {...claim,statementMasked:gate.masked.text,locator:{...locator,
      review_required:reviewFields.length>0,review_fields:reviewFields}};
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
        materiality:claim.materiality,expected_revision_no:1,source_page_no:claim.locator.page_no,
        requires_review:claim.locator.review_required,review_fields:claim.locator.review_fields});
    }
    return results;
  });
  return {case_id:caseId,input_id:inputId,input_purpose:file.input_purpose??"PROPOSAL",claims,masked_pages:maskedPages,masked_text:maskedText};
}
