import { afterAll, beforeAll, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { processFileInput } from "../files/process";

vi.mock("../files/storage", () => ({ readQuarantinedFile: async () => Buffer.from("89504e470d0a1a0a", "hex") }));
vi.mock("../files/parser", () => ({ parseIsolatedFile: async () => ({ mime: "image/png", needs_ocr: true,
  pages: [{ page_no: 1, text: "", words: [] }] }) }));
vi.mock("../files/ocr", () => ({ extractWithOcr: async (args: {authorize: () => Promise<boolean>}) => {
  if (!await args.authorize()) throw new Error("OCR_CONSENT_REQUIRED");
  return [{ page_no: 1, text: "연 3% 금리 https://refinance.exaimple/loan", words: [
    {text:"연 3% 금리",confidence:0.991,bbox:[0,0,40,10]},
    {text:"https://refinance.exaimple/loan",confidence:0.591,bbox:[45,0,180,10]},
  ] }];
} }));

const dsn = process.env.FINSHIELD_TEST_DSN;
const adminDsn = process.env.FINSHIELD_TEST_ADMIN_DSN;
const sql = postgres(dsn ?? "", { prepare: false, max: 1 });
const admin = postgres(adminDsn ?? "", { prepare: false, max: 1 });
const owner = randomUUID();
beforeAll(async () => {
  if (!dsn || !adminDsn) return;
  if (![dsn, adminDsn].every(url => ["localhost", "127.0.0.1"].includes(new URL(url).hostname))) {
    throw new Error("LOCAL_FIXTURE_DATABASE_ONLY");
  }
  vi.stubEnv("FINSHIELD_DATABASE_URL", dsn);
  vi.stubEnv("SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_local_fixture");
  vi.stubEnv("CLOVA_OCR_SECRET", "fixture");
  vi.stubEnv("CLOVA_OCR_INVOKE_URL", "https://example.invalid");
  await admin`insert into auth.users(id) values(${owner}::uuid)`;
});
afterAll(async () => { vi.unstubAllEnvs(); await sql.end(); await admin.end(); });

it.skipIf(!dsn || !adminDsn)("OCR 후 메모리 임시물 부재 기록·Claim 저장과 중복 소비 차단을 실제 DB로 확인한다", async () => {
  const [kase] = await sql`select private.create_case(${owner}::uuid,'LOAN','합성 OCR 계약',${randomUUID()},${"a".repeat(64)}) as id`;
  const [slot] = await sql`select * from private.open_upload_slot(${owner}::uuid,${kase.id}::uuid,'IMAGE','image/png',8,1,3600)`;
  const args = { sql, ownerId: owner, caseId: kase.id, inputId: slot.case_input_id, ocrConsent: true,
    extractClaims: async () => [{ claimType: "PRODUCT_TERM" as const,
      statementMasked: "안내 주소 https://refinance.exaimple/loan", materiality: "MATERIAL" as const,
      sourceQuote: "https://refinance.exaimple/loan" }] };
  const result = await processFileInput(args);
  expect(result.claims).toHaveLength(1);
  expect(result.claims[0].source_page_no).toBe(1);
  expect(result.claims[0]).toMatchObject({requires_review:true,review_fields:[{
    field_kind:"URL",confidence_milli:591,bbox:[45,0,180,10],start:8,end:39,
  }]});
  expect(result.masked_pages[0]).toMatchObject({low_confidence_count:1});
  const pages = await admin`select masked_text,low_confidence_count,locator_schema_version from public.case_input_pages where case_input_id=${slot.case_input_id}::uuid`;
  expect(pages[0]).toMatchObject({masked_text:"연 3% 금리 https://refinance.exaimple/loan",low_confidence_count:1,locator_schema_version:"ocr-review-v1"});
  const findings = await admin`select finding_code,locator from public.case_input_findings where case_input_id=${slot.case_input_id}::uuid`;
  expect(findings).toEqual([expect.objectContaining({finding_code:"OCR_URL",locator:expect.objectContaining({
    schema_version:"ocr-review-v1",page_no:1,field_kind:"URL",confidence_milli:591,
  })})]);
  expect(JSON.stringify(findings)).not.toContain("refinance");

  const selection = [{claim_id:result.claims[0].claim_id,expected_revision_no:1,
    statement_masked:result.claims[0].statement_masked}];
  await expect(sql`select private.confirm_case_claims(${owner}::uuid,${kase.id}::uuid,
    ${JSON.stringify(selection)}::text::jsonb)`).rejects.toThrow(/OCR_REVIEW_REQUIRED/);
  await sql`select private.confirm_case_claims(${owner}::uuid,${kase.id}::uuid,
    ${JSON.stringify([{...selection[0],ocr_reviewed:true}])}::text::jsonb)`;
  const [revision] = await admin`select user_confirmed,structured_value from public.claim_revisions
    where claim_id=${result.claims[0].claim_id}::uuid order by revision_no desc limit 1`;
  expect(revision).toMatchObject({user_confirmed:true,structured_value:expect.objectContaining({ocr_reviewed:true})});
  const artifacts = await admin`select status,storage_object_path,deleted_at from private.ocr_artifacts where case_id=${kase.id}::uuid`;
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({status:"DELETED",storage_object_path:null});
  expect(artifacts[0].deleted_at).not.toBeNull();
  const jobs = await admin`select reason_code,status from private.file_cleanup_jobs where case_id=${kase.id}::uuid`;
  expect(jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({reason_code:"OBJECT_MISSING",status:"SUCCEEDED"}),
    expect.objectContaining({reason_code:"CLAIM_CONFIRMED",status:"QUEUED"}),
  ]));
  await expect(processFileInput(args)).rejects.toMatchObject({code:"42501"});
  const original = await admin`select deleted_at,access_blocked_at from private.input_objects where case_input_id=${slot.case_input_id}::uuid`;
  expect(original[0].deleted_at).toBeNull();
  expect(original[0].access_blocked_at).not.toBeNull();
});
