/**
 * 근거는 오직 Tool 결과에서만 나온다 — 실제 schema 에 대고 확인한다.
 *
 * FINSHIELD_TEST_DSN 이 있을 때만 돈다. 없으면 건너뛴다. CI 의 계약 시험은
 * DB 없이 돌아야 하기 때문이다. 로컬에서는 supabase/tests/run-local.sh 가
 * 만든 컨테이너를 가리키면 된다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createRunSession, runTool, sha256, type ToolOutcome } from "../tools/runtime";
import { parseUrlHost } from "../tools/url";
import { DEFINITION_VERSION } from "../manifest";
import { loadManifest, resetManifestCache } from "../registry";

const dsn = process.env.FINSHIELD_TEST_DSN;
// fixture 를 만들려면 소유자 표에 쓸 수 있어야 한다. Worker 에게는 그 권한이 없고
// 그것이 설계다. 그래서 준비는 관리자 연결로 하고 측정은 Worker 연결로 한다.
const adminDsn = process.env.FINSHIELD_TEST_ADMIN_DSN;
const maybe = dsn && adminDsn ? describe : describe.skip;

maybe("근거 사슬", () => {
  const sql = postgres(dsn ?? "", { prepare: false, max: 1, onnotice: () => {} });
  const admin = postgres(adminDsn ?? "", { prepare: false, max: 1, onnotice: () => {} });
  let ownerId = "";
  let caseId = "";
  let runId = "";
  let agentRunId = "";

  beforeAll(async () => {
    resetManifestCache();
    const manifest = await loadManifest(sql);
    const owner = await admin`select gen_random_uuid() as id`;
    ownerId = owner[0].id as string;
    await admin`insert into auth.users (id) values (${ownerId}::uuid)`;
    await admin`
      insert into public.financial_profiles
        (owner_id, schema_version, income_band, debt_burden_band, emergency_fund_band,
         purpose_code, horizon_code, liquidity_need, loss_tolerance, completeness)
      values (${ownerId}::uuid, 'v1', 'BAND_2', 'LOW', 'BAND_1', 'LOAN_REFINANCE', 'SHORT', 'MEDIUM', 'LOW', 'COMPLETE')`;
    const created = await sql`
      select private.create_case(${ownerId}::uuid, 'LOAN'::public.case_scenario, '근거 사슬 시험',
        ${`chain-${Date.now()}`}::text, ${"a".repeat(64)}::text) as id`;
    caseId = created[0].id as string;
    // 초기 검증은 INPUT_REVIEW 에서만 시작한다. 입력 검토를 마쳤다는 뜻이다.
    await sql`select private.transition_financial_case(${ownerId}::uuid, ${caseId}::uuid,
      'INPUT_REVIEW'::public.case_lifecycle, 'SYSTEM', 'INPUT_READY') as ok`;
    const input = await sql`select private.create_text_input(${ownerId}::uuid, ${caseId}::uuid, 128::bigint, 3600) as id`;
    const inputId = input[0].id as string;
    // Run 은 PII Gate 를 지난 입력에서만 시작한다. 단계를 건너뛰지 않고 하나씩 올린다.
    for (const [stage, patch] of [
      ["VALIDATED", {}],
      ["EXTRACTED", {}],
      ["MASKED", { masked_text: "마스킹된 상담 내용", masked_text_hash: "c".repeat(64), pii_policy_version: "pii-policy-v1" }],
    ] as const) {
      await sql`select id from private.advance_input_stage(${ownerId}::uuid, ${caseId}::uuid,
        ${inputId}::uuid, ${stage}::public.input_stage, ${JSON.stringify(patch)}::text::jsonb)`;
    }
    // CLM-003: 확정한 Claim 이 없으면 검증을 시작하지 않는다.
    const claim = await sql`select private.record_extracted_claim(${ownerId}::uuid, ${caseId}::uuid,
      ${inputId}::uuid, null, 'PRODUCT_TERM', '햇살론15 금리가 연 3%라고 들었다') as id`;
    await sql`select private.confirm_claim(${ownerId}::uuid, ${caseId}::uuid, ${claim[0].id}::uuid) as n`;
    const run = await sql`
      select private.create_verification_run(${ownerId}::uuid, ${caseId}::uuid,
        ${manifest.manifestId}::uuid, ${`run-${Date.now()}`}::text, ${"b".repeat(64)}::text,
        'INITIAL'::public.verification_run_kind, null) as id`;
    runId = run[0].id as string;
    const agentRun = await sql`
      insert into public.agent_runs
        (owner_id, case_id, verification_run_id, logical_agent_key, agent_code, agent_version,
         attempt_no, status, input_schema_version, output_schema_version, prompt_version, started_at)
      values (${ownerId}::uuid, ${caseId}::uuid, ${runId}::uuid, 'FRAUD_CHANNEL', 'FRAUD_CHANNEL', ${DEFINITION_VERSION},
              1, 'RUNNING'::public.execution_status, 'in-v1', 'out-v1', 'fraud-channel-v1', now())
      returning id`;
    agentRunId = agentRun[0].id as string;
  }, 60_000);

  afterAll(async () => { await sql.end({ timeout: 5 }); await admin.end({ timeout: 5 }); });

  const session = () => createRunSession({
    sql, ownerId, caseId, runId,
    manifest: { manifestId: "", kbReleaseId: "", agentIds: {}, toolIds: {} },
  });

  it("Tool 결과가 근거가 되고 인용 이름이 붙는다", async () => {
    const s = session();
    // 사용자가 낸 주소는 공식 출처가 아니므로 근거가 되지 않는다. 맥락으로만 남는다.
    const urlResult = await runTool(s, agentRunId, "FRAUD_CHANNEL", "parse_url_host", "PARSE_URL",
      { urls: ["https://apply.example.co.kr/loan"] }, parseUrlHost);
    expect(urlResult.evidence).toEqual([]);
    expect(urlResult.observations).toMatchObject({ kind: "url_facts" });

    // 공식 출처를 돌려주는 도구는 근거가 되고 인용 이름이 붙는다.
    const official = async (): Promise<ToolOutcome> => ({
      items: [{
        sourceType: "GUIDE", authorityGrade: "B", publisher: "서민금융진흥원",
        title: "공식 신청 채널 안내", officialId: "kinfa:guide:1", canonicalUrl: null,
        publishedAt: null, sourceVersion: "v1", contentHash: sha256("guide"),
        fingerprint: sha256("kinfa:guide:1"), freshness: "FRESH", licenseCode: null,
        isComplete: true, isCitable: true, locator: { kind: "guide" },
        excerptMasked: "공식 신청은 안내된 경로로만 받는다", directness: "DIRECT",
        referenceOnly: false, selectionReasonCode: "OFFICIAL_CHANNEL",
      }],
      provenanceComplete: true, candidateCount: 1,
    });
    const result = await runTool(s, agentRunId, "FRAUD_CHANNEL", "lookup_official_channel", "VERIFY_CHANNEL",
      {}, official);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].evidence_ref).toBe("E1");
    expect(s.evidence.get("E1")?.tool_code).toBe("lookup_official_channel");
    const rows = await sql`
      select count(*)::int as n from public.evidences where verification_run_id = ${runId}::uuid`;
    expect(rows[0].n).toBeGreaterThan(0);
  }, 30_000);

  it("Allowlist 밖 목적으로는 부를 수 없다", async () => {
    await expect(runTool(session(), agentRunId, "FRAUD_CHANNEL", "lookup_statute", "LOOKUP_STATUTE",
      {}, parseUrlHost)).rejects.toThrow();
  });

  it("Provenance 가 불완전하면 근거를 만들지 않는다", async () => {
    const before = await sql`select count(*)::int as n from public.evidences where verification_run_id = ${runId}::uuid`;
    const incomplete = async (): Promise<ToolOutcome> => ({
      items: [{
        sourceType: "LAW", authorityGrade: "A", publisher: "법제처", title: "출처 불명",
        officialId: null, canonicalUrl: null, publishedAt: null, sourceVersion: null,
        contentHash: sha256("x"), fingerprint: sha256("f"), freshness: "UNKNOWN", licenseCode: null,
        isComplete: false, isCitable: false, locator: {}, excerptMasked: "", directness: "INDIRECT",
        referenceOnly: false, selectionReasonCode: "TEST",
      }],
      provenanceComplete: false, candidateCount: 1,
    });
    const produced = await runTool(session(), agentRunId, "FRAUD_CHANNEL", "parse_url_host", "PARSE_URL", {}, incomplete);
    expect(produced.evidence).toEqual([]);
    const after = await sql`select count(*)::int as n from public.evidences where verification_run_id = ${runId}::uuid`;
    expect(after[0].n).toBe(before[0].n);
  }, 30_000);

  it("Tool 이 실패해도 실행 기록은 남고 근거는 비어 있다", async () => {
    const boom = async (): Promise<ToolOutcome> => { throw new Error("boom"); };
    const produced = await runTool(session(), agentRunId, "FRAUD_CHANNEL", "parse_url_host", "PARSE_URL", {}, boom);
    expect(produced.evidence).toEqual([]);
    const rows = await sql`
      select count(*)::int as n from public.tool_runs
       where verification_run_id = ${runId}::uuid and status = 'FAILED'::public.execution_status`;
    expect(rows[0].n).toBeGreaterThan(0);
  }, 30_000);
});
