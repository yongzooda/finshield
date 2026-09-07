import { it, expect, vi } from "vitest";
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { processFileInput } from "../files/process";
import { createClaimExtractor } from "../agents/model-adapter";
import * as ocr from "../files/ocr";

// 이 격리 component 시험에서는 Storage 전송만 대체한다. Parser VM·모델·worker DB는 실제 실행한다.
vi.mock("../files/storage",()=>({readQuarantinedFile:async()=>readFileSync(".github/fixtures/finshield/synthetic-loan.pdf")}));
it.skipIf(process.env.FINSHIELD_LIVE_FILE_PROBE!=="1")("합성 PDF → 격리 Parser → PII → 실제 모델 → worker 페이지·Claim 저장",async()=>{
 const url=process.env.FINSHIELD_DATABASE_URL!;
 if(!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw new Error("격리 로컬 DB만 사용할 수 있다");
 const sql=postgres(url,{prepare:false,max:1});
 try {
  await sql`set role finshield_worker`;
  const owner="00000000-0000-4000-8000-00000000000a";
  const [kase]=await sql`select private.create_case(${owner}::uuid,'LOAN','합성 PDF 연결 시험',${randomUUID()},${"f".repeat(64)}) as id`;
  const bytes=readFileSync(".github/fixtures/finshield/synthetic-loan.pdf");
  const [slot]=await sql`select * from private.open_upload_slot(${owner}::uuid,${kase.id}::uuid,'PDF','application/pdf',${bytes.length},1,86400)`;
  const send=vi.spyOn(ocr,"extractWithOcr");const started=Date.now();
  const result=await processFileInput({sql,ownerId:owner,caseId:kase.id,inputId:slot.case_input_id,
    ocrConsent:false,extractClaims:createClaimExtractor(),signal:AbortSignal.timeout(50000)});
  expect(send).not.toHaveBeenCalled();expect(result.masked_pages).toHaveLength(1);
  expect(result.claims.length).toBeGreaterThanOrEqual(4);
  expect(result.claims.every(claim=>claim.source_page_no===1)).toBe(true);
  expect(result.claims.some(claim=>claim.statement_masked.includes("3%"))).toBe(true);
  writeFileSync("/tmp/finshield-file-component-probe.json",JSON.stringify({mode:"LIVE_PARSER_MODEL_LOCAL_DB_MOCK_STORAGE",elapsed_ms:Date.now()-started,
    case_id:result.case_id,input_id:result.input_id,claims:result.claims,ocr_calls:send.mock.calls.length},null,2),{mode:0o600});
 }finally{await sql.end({timeout:2});}
},60000);
