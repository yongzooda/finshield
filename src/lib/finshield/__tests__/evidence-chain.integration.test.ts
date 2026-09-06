/**
 * 근거는 오직 Tool 결과에서만 나온다 — 실제 schema 에 대고 확인한다.
 *
 * FINSHIELD_TEST_DSN 이 있을 때만 돈다. 없으면 건너뛴다. CI 의 계약 시험은
 * DB 없이 돌아야 하기 때문이다. 로컬에서는 supabase/tests/run-local.sh 가
 * 만든 컨테이너를 가리키면 된다.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createRunSession, executeTool, persistToolRuns, sha256, type ToolOutcome } from "../tools/runtime";
import { parseUrlHost } from "../tools/url";
import { runDomainAgent, type AgentModel } from "../agents/runner";
import { runVerification, type JudgeModel } from "../orchestrator";
import type { DomainAgentInput } from "../schemas";
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
    // 공식 채널 등록부에 한 줄 넣어 둔다. 적재는 관리자 역할의 일이다.
    await admin`
      insert into kb.source_snapshots
        (source_type, authority_level, publisher_name, source_title, official_id, source_version,
         retrieved_at, content_hash, source_fingerprint, freshness_status, is_complete, is_citable)
      values ('GUIDE', 'B', '서민금융진흥원', '공식 신청 채널 안내', 'kinfa:channel:test', 'v1',
              now(), ${"1".repeat(64)}, ${"2".repeat(64)}, 'FRESH', true, true)
      on conflict do nothing`;
    await admin`
      insert into kb.official_channel_registry
        (institution_code, channel_type, normalized_value, display_value, source_snapshot_id, valid_from)
      select 'KINFA', 'URL', 'kinfa.or.kr', 'https://www.kinfa.or.kr', s.id, current_date
        from kb.source_snapshots s where s.official_id = 'kinfa:channel:test'
      on conflict do nothing`;

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
    const pendings = [];
    // 사용자가 낸 주소는 공식 출처가 아니므로 근거가 되지 않는다. 맥락으로만 남는다.
    const urlResult = await executeTool(s, "FRAUD_CHANNEL", "parse_url_host", "PARSE_URL",
      { urls: ["https://apply.example.co.kr/loan"] }, parseUrlHost);
    pendings.push(urlResult.pending);
    expect(urlResult.evidence).toEqual([]);
    expect(urlResult.pending.observations).toMatchObject({ kind: "url_facts" });

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
    const result = await executeTool(s, "FRAUD_CHANNEL", "lookup_official_channel", "VERIFY_CHANNEL",
      {}, official);
    pendings.push(result.pending);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].evidence_ref).toBe("E1");
    expect(s.evidence.get("E1")?.tool_code).toBe("lookup_official_channel");

    // 기록은 실행이 끝난 뒤 한 번에 남긴다.
    await persistToolRuns(s, agentRunId, pendings);
    const rows = await sql`
      select count(*)::int as n from public.evidences where verification_run_id = ${runId}::uuid`;
    expect(rows[0].n).toBeGreaterThan(0);
  }, 30_000);

  it("Allowlist 밖 목적으로는 부를 수 없다", async () => {
    await expect(executeTool(session(), "FRAUD_CHANNEL", "lookup_statute", "LOOKUP_STATUTE",
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
    const s = session();
    const produced = await executeTool(s, "FRAUD_CHANNEL", "parse_url_host", "PARSE_URL", {}, incomplete);
    expect(produced.evidence).toEqual([]);
    await persistToolRuns(s, agentRunId, [produced.pending]);
    const after = await sql`select count(*)::int as n from public.evidences where verification_run_id = ${runId}::uuid`;
    expect(after[0].n).toBe(before[0].n);
  }, 30_000);

  it("Tool 이 실패해도 실행 기록은 남고 근거는 비어 있다", async () => {
    const boom = async (): Promise<ToolOutcome> => { throw new Error("boom"); };
    const s = session();
    const produced = await executeTool(s, "FRAUD_CHANNEL", "parse_url_host", "PARSE_URL", {}, boom);
    expect(produced.evidence).toEqual([]);
    await persistToolRuns(s, agentRunId, [produced.pending]);
    const rows = await sql`
      select count(*)::int as n from public.tool_runs
       where verification_run_id = ${runId}::uuid and status = 'FAILED'::public.execution_status`;
    expect(rows[0].n).toBeGreaterThan(0);
  }, 30_000);

  const agentInput = (): DomainAgentInput => ({
    schema_version: "in-v1",
    agent_code: "FRAUD_CHANNEL",
    scenario: "LOAN",
    journey_stage: "PRE_TRANSACTION",
    claims: [{ claim_ref: "C1", claim_type: "CHANNEL", statement_masked: "문자로 받은 주소로 신청하라고 했다", materiality: "MATERIAL" }],
    masked_intake: "마스킹된 상담 내용",
  });

  const officialTool = async () => ({
    items: [{
      sourceType: "GUIDE", authorityGrade: "B" as const, publisher: "서민금융진흥원",
      title: "공식 신청 채널 안내", officialId: "kinfa:guide:agent", canonicalUrl: null,
      publishedAt: null, sourceVersion: "v1", contentHash: sha256("agent-guide"),
      fingerprint: sha256("kinfa:guide:agent"), freshness: "FRESH" as const, licenseCode: null,
      isComplete: true, isCitable: true, locator: { kind: "guide" },
      excerptMasked: "공식 신청은 안내된 경로로만 받는다", directness: "DIRECT" as const,
      referenceOnly: false, selectionReasonCode: "OFFICIAL_CHANNEL",
    }],
    provenanceComplete: true, candidateCount: 1,
  });

  it("Agent 는 허용된 Tool 만 부르고 근거를 인용해 판단한다", async () => {
    let asked = 0;
    const model: AgentModel = {
      chooseTools: async () => (asked++ === 0
        ? [{ toolCode: "lookup_official_channel", input: {} }]
        : []),
      decide: async ({ evidence }) => ({
        schema_version: "out-v1",
        findings: [{
          claim_ref: "C1", state: "VERIFIED", relation: "SUPPORT",
          evidence_refs: [evidence[0].evidence_ref],
          summary_masked: "안내된 공식 경로가 확인됩니다", limits: [],
        }],
        out_of_scope_claim_refs: [],
      }),
    };
    const result = await runDomainAgent({
      session: session(), agentCode: "FRAUD_CHANNEL", input: agentInput(), model,
      impls: { lookup_official_channel: officialTool },
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.output?.findings[0].state).toBe("VERIFIED");
    expect(result.toolCalls).toBe(1);
    const rows = await sql`
      select status::text as status from public.agent_runs where id = ${result.agentRunId}::uuid`;
    expect(rows[0].status).toBe("SUCCEEDED");
  }, 30_000);

  it("허용 목록 밖 Tool 을 고르면 부르지 않고 그 사실을 남긴다", async () => {
    const model: AgentModel = {
      chooseTools: async () => [{ toolCode: "lookup_statute", input: {} }],
      decide: async () => ({ schema_version: "out-v1", findings: [], out_of_scope_claim_refs: ["C1"] }),
    };
    const result = await runDomainAgent({
      session: session(), agentCode: "FRAUD_CHANNEL", input: agentInput(), model,
      impls: { lookup_statute: officialTool },
    });
    expect(result.toolCalls).toBe(0);
    expect(result.reasonCode).toBe("TOOL_NOT_ALLOWED");
  }, 30_000);

  it("지어낸 근거를 인용하면 판단을 버린다", async () => {
    const model: AgentModel = {
      chooseTools: async () => [],
      decide: async () => ({
        schema_version: "out-v1",
        findings: [{
          claim_ref: "C1", state: "VERIFIED", relation: "SUPPORT", evidence_refs: ["E99"],
          summary_masked: "확인했습니다", limits: [],
        }],
        out_of_scope_claim_refs: [],
      }),
    };
    const result = await runDomainAgent({
      session: session(), agentCode: "FRAUD_CHANNEL", input: agentInput(), model,
      impls: {},
    });
    expect(result.status).toBe("FAILED");
    expect(result.reasonCode).toBe("CITATION_INVALID");
    expect(result.output).toBeNull();
  }, 30_000);

  it("근거 없이 확정하면 판단을 버린다", async () => {
    const model: AgentModel = {
      chooseTools: async () => [],
      decide: async () => ({
        schema_version: "out-v1",
        findings: [{
          claim_ref: "C1", state: "CONTRADICTED", relation: "CONTRADICT", evidence_refs: [],
          summary_masked: "사실이 아닙니다", limits: [],
        }],
        out_of_scope_claim_refs: [],
      }),
    };
    const result = await runDomainAgent({
      session: session(), agentCode: "FRAUD_CHANNEL", input: agentInput(), model, impls: {},
    });
    expect(result.status).toBe("FAILED");
    expect(result.reasonCode).toBe("CITATION_INVALID");
  }, 30_000);


  it("네 Agent 를 순서대로 돌리고 Judge 가 구조만 보고 정한다", async () => {
    const seen: string[] = [];
    const askedOnce = new Set<string>();
    const agentModel: AgentModel = {
      chooseTools: async ({ input }) => {
        if (!seen.includes(input.agent_code)) seen.push(input.agent_code);
        // 한 번만 도구를 고르고 그다음에는 그만 부른다.
        if (askedOnce.has(input.agent_code)) return [];
        askedOnce.add(input.agent_code);
        return input.agent_code === "FRAUD_CHANNEL"
          ? [{ toolCode: "lookup_official_channel", input: { values: ["https://kinfa.or.kr"] } }]
          : [];
      },
      decide: async ({ input, evidence }) => ({
        schema_version: "out-v1",
        findings: evidence.length > 0
          ? [{
              claim_ref: "C1", state: "VERIFIED", relation: "SUPPORT",
              evidence_refs: [evidence[0].evidence_ref],
              summary_masked: `${input.agent_code} 확인함`, limits: [],
            }]
          : [{
              claim_ref: "C1", state: "UNKNOWN", relation: "CONTEXT", evidence_refs: [],
              summary_masked: `${input.agent_code} 범위에서 확인하지 못함`, limits: ["자료 없음"],
            }],
        out_of_scope_claim_refs: [],
      }),
    };
    let judgeSawIntake = false;
    const judgeModel: JudgeModel = {
      judge: async (args) => {
        judgeSawIntake = JSON.stringify(args).includes("마스킹된 상담 내용");
        const supported = args.evidence[0]?.evidence_ref;
        return {
          schema_version: "out-v1",
          claim_results: [{
            claim_ref: "C1", state: supported ? "VERIFIED" : "UNKNOWN",
            evidence_refs: supported ? [supported] : [],
            withheld_reason: supported ? null : "근거를 찾지 못했습니다",
            rationale_masked: "공식 안내로 확인했습니다",
          }],
          conflicts: [],
        };
      },
    };

    const result = await runVerification({
      ctx: { sql, ownerId, caseId, runId, manifest: { manifestId: "", kbReleaseId: "", agentIds: {}, toolIds: {} } },
      claims: agentInput().claims,
      maskedIntake: "마스킹된 상담 내용",
      journeyStage: "PRE_TRANSACTION",
      agentModel, judgeModel,
    });

    // AI-021: Domain Agent 는 넷이고 Manifest 순서대로 돈다.
    expect(seen).toEqual(["PRODUCT_INSTITUTION", "FRAUD_CHANNEL", "SALES_CONDUCT", "REGULATION_DISPUTE"]);
    expect(result.agentResults).toHaveLength(4);
    // AI-013: Judge 입력에 원문이 들어가지 않는다.
    expect(judgeSawIntake).toBe(false);
    expect(result.judgeOutput?.claim_results[0].state).toBe("VERIFIED");
    const runs = await sql`
      select count(*)::int as n from public.agent_runs where verification_run_id = ${runId}::uuid`;
    expect(runs[0].n).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it("Judge 가 지어낸 근거를 인용하면 결과를 버리고 부분 실패로 남긴다", async () => {
    const agentModel: AgentModel = {
      chooseTools: async () => [],
      decide: async () => ({ schema_version: "out-v1", findings: [], out_of_scope_claim_refs: ["C1"] }),
    };
    const judgeModel: JudgeModel = {
      judge: async () => ({
        schema_version: "out-v1",
        claim_results: [{
          claim_ref: "C1", state: "VERIFIED", evidence_refs: ["E999"],
          withheld_reason: null, rationale_masked: "확인했습니다",
        }],
        conflicts: [],
      }),
    };
    const result = await runVerification({
      ctx: { sql, ownerId, caseId, runId, manifest: { manifestId: "", kbReleaseId: "", agentIds: {}, toolIds: {} } },
      claims: agentInput().claims,
      maskedIntake: "마스킹된 상담 내용",
      journeyStage: "PRE_TRANSACTION",
      agentModel, judgeModel,
    });
    expect(result.judgeOutput).toBeNull();
    expect(result.judgeReasonCode).toBe("JUDGE_CITATION_INVALID");
    expect(result.partial).toBe(true);
  }, 60_000);

});
