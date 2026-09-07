import { afterAll, beforeAll, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { processFileInput } from "../files/process";

vi.mock("../files/storage", () => ({ readQuarantinedFile: async () => Buffer.from("89504e470d0a1a0a", "hex") }));
vi.mock("../files/parser", () => ({ parseIsolatedFile: async () => ({ mime: "image/png", needs_ocr: true,
  pages: [{ page_no: 1, text: "", words: [] }] }) }));
vi.mock("../files/ocr", () => ({ extractWithOcr: async (args: {authorize: () => Promise<boolean>}) => {
  if (!await args.authorize()) throw new Error("OCR_CONSENT_REQUIRED");
  return [{ page_no: 1, text: "연 3% 금리", words: [] }];
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
    extractClaims: async () => [{ claimType: "PRODUCT_TERM" as const, statementMasked: "연 3% 금리", materiality: "MATERIAL" as const, sourceQuote: "연 3% 금리" }] };
  const result = await processFileInput(args);
  expect(result.claims).toHaveLength(1);
  expect(result.claims[0].source_page_no).toBe(1);
  const artifacts = await admin`select status,storage_object_path,deleted_at from private.ocr_artifacts where case_id=${kase.id}::uuid`;
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({status:"DELETED",storage_object_path:null});
  expect(artifacts[0].deleted_at).not.toBeNull();
  const jobs = await admin`select reason_code,status from private.file_cleanup_jobs where case_id=${kase.id}::uuid`;
  expect(jobs).toEqual([expect.objectContaining({reason_code:"OBJECT_MISSING",status:"SUCCEEDED"})]);
  await expect(processFileInput(args)).rejects.toMatchObject({code:"42501"});
  const original = await admin`select deleted_at,access_blocked_at from private.input_objects where case_input_id=${slot.case_input_id}::uuid`;
  expect(original[0]).toMatchObject({deleted_at:null,access_blocked_at:null});
});
