/**
 * 공개 Live Seed Demo (S-001, ROLE-001, 명세 6.10).
 *
 * 로그인 없이 실제 파이프라인을 한 번 돌려 볼 수 있게 한다. 판단하는 코드는
 * 회원 실행과 같은 것을 쓰고, 남기는 자리만 `demo` 로 바꾼다. 그래서 끝난 뒤에
 * 회원 Case·프로필·입력이 하나도 생기지 않는다.
 *
 * 입력은 미리 승인한 합성 Seed 하나뿐이다. 방문자의 문장을 받지 않는다. 받지
 * 않으면 마스킹을 잘못할 일도, 남길 일도 없다.
 *
 * 결과에는 실제 실행인지 사전 계산인지를 함께 남긴다. 사전 계산을 실시간 실행인
 * 것처럼 보이지 않게 하기 위해서다 (OPS-004).
 */

import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { loadManifest } from "./registry";
import { runVerification, type RunProgress } from "./orchestrator";
import { createAgentModel, createJudgeModel } from "./agents/model-adapter";
import { TOOLS } from "./manifest";
import { recordSnapshot, type PendingToolRun, type RunRecorder } from "./tools/runtime";
import type { ConfirmedClaim } from "./schemas";
import { buildActionGuide } from "./action-guide";
import { buildAxisResults, buildFinalClaims, type FinalClaim } from "./finalize";
import { hasHighRiskAction } from "./high-risk-actions";

type Sql = ReturnType<typeof postgres>;

export const DEMO_SEED_CODE = "sunshine-loan-15";
// v2 부터 회원 결과와 같은 최종 상태·종합 결과·세 축·행동 안내를 담는다.
export const RESULT_SCHEMA_VERSION = "demo-result-v2";

const UNDECIDED_STATES = ["UNKNOWN", "NEED_MORE_INFORMATION", "WITHHELD"];
// 0016 finalize_verification_run 의 기본 pre_action_codes 와 같다.
const PRE_ACTION_CODES = ["VERIFY_OFFICIAL_CHANNEL", "CONFIRM_CONTRACT_TERMS", "CONFIRM_BEFORE_TRANSFER"];

/**
 * 종합 결과 Matrix 의 입력을 센다.
 *
 * 회원 Run 은 DB 의 finalize_verification_run 이 같은 여덟 값을 세어
 * private.decide_overall_result 에 넘긴다. Demo 는 회원 표를 쓰지 않으므로 값만
 * 여기서 세고 결과 범주는 같은 DB 함수가 정한다. 두 화면이 다른 결론을 내지 않게
 * 하기 위해서다.
 */
export const overallInputs = (args: {
  finals: FinalClaim[];
  isMaterial: (claimId: string) => boolean;
  agentPartial: boolean;
  guideActionCodes: string[];
}) => {
  const material = args.finals.filter((entry) => args.isMaterial(entry.claim_id));
  const supporting = args.finals.filter((entry) => !args.isMaterial(entry.claim_id));
  const undecided = material.some((entry) => UNDECIDED_STATES.includes(entry.status));
  return {
    materialContradicted: material.some((entry) => entry.status === "CONTRADICTED"),
    highRisk: hasHighRiskAction(args.finals),
    nonMaterialContradicted: supporting.some((entry) => entry.status === "CONTRADICTED"),
    materialConflict: material.some((entry) => entry.status === "CONFLICT"),
    materialUndecided: undecided,
    agentPartial: args.agentPartial,
    // Demo Seed 의 Claim 은 미리 확인된 것이고 필수 Claim 유형 계약도 비어 있다.
    coverageSatisfied: !undecided,
    preActionRemaining: supporting.some((entry) => entry.status !== "VERIFIED")
      || args.guideActionCodes.some((code) => PRE_ACTION_CODES.includes(code)),
  };
};

export type DemoSession = {
  sessionId: string;
  capabilityToken: string;
  expiresAt: string;
  seedVersionId: string;
};

export class DemoUnavailableError extends Error {}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * 공개 실행 상한. 한 회에 모델 비용이 약 USD 0.11 든다.
 *
 * 심사장처럼 여러 사람이 한 주소를 함께 쓰면 주소별 시간 상한이 금방 찬다. 그래서
 * 주소별 시간 상한을 넉넉히 두고, 한 주소가 하루 예산을 다 쓰지 못하게 주소별 하루
 * 상한과 전체 하루 상한을 함께 둔다. 전체 하루 상한은 모델 전체 일일 예산
 * (USD 20, 0046)의 절반 남짓이라 회원 검증 몫을 남긴다.
 *
 * 범위 값은 데이터베이스가 정한 다섯 가지 중에서 고른다. 주소는 해시로만 들고
 * 있으므로 `IP_HMAC` 이다. 없는 낱말을 새로 만들면 제약이 막는다.
 */
export const DEMO_LIMITS = [
  { scope: "IP_HMAC", operation: "DEMO_RUN", limit: 6, windowSeconds: 3600 },
  { scope: "IP_HMAC", operation: "DEMO_RUN_DAY", limit: 30, windowSeconds: 86400 },
  { scope: "GLOBAL", operation: "DEMO_RUN_ALL_DAY", limit: 100, windowSeconds: 86400 },
] as const;

class DemoLimitReached extends Error {}

/**
 * 세 상한을 한 트랜잭션에서 차례로 쓴다. 하나라도 차면 앞서 올린 횟수까지 되돌린다.
 * 실행하지 못한 요청이 다른 상한을 깎아 먹지 않게 하기 위해서다.
 */
export const allowDemo = async (sql: Sql, visitorKey: string): Promise<boolean> => {
  try {
    await sql.begin(async (tx) => {
      for (const bucket of DEMO_LIMITS) {
        const key = bucket.scope === "GLOBAL" ? "public-demo" : visitorKey;
        const rows = await tx`
          select allowed from private.consume_rate_limit(${bucket.scope}, ${key}, ${bucket.operation},
                                                         ${bucket.limit}, ${bucket.windowSeconds})`;
        if (rows[0]?.allowed !== true) throw new DemoLimitReached();
      }
    });
    return true;
  } catch (error) {
    if (error instanceof DemoLimitReached) return false;
    throw error;
  }
};

/**
 * 가장 최근에 끝까지 성공한 실제 공개 실행 결과를 읽는다.
 *
 * 상한에 걸린 방문자에게 빈 화면 대신 보여 줄 수 있게 한다. 사전 계산 결과가
 * 아니라 과거의 실제 실행 기록이며, 화면은 실행 시각을 함께 적어 지금 실행한
 * 결과처럼 보이지 않게 한다 (OPS-004). 부분 실행이나 사전 계산 결과는 고르지 않는다.
 */
export const readRecentResult = async (sql: Sql): Promise<{ computedAt: string; manifest: Record<string, unknown> } | null> => {
  const rows = await sql`
    select rs.result_manifest, rs.computed_at
      from demo.result_snapshots rs
      join demo.runs r on r.id = rs.demo_run_id
     where r.status = 'SUCCEEDED' and rs.is_precomputed = false
     order by rs.computed_at desc
     limit 1`;
  const row = rows[0];
  if (!row) return null;
  return { computedAt: new Date(row.computed_at as string).toISOString(), manifest: row.result_manifest as Record<string, unknown> };
};

export const createSession = async (sql: Sql): Promise<DemoSession> => {
  let rows;
  try {
    rows = await sql`
      select session_id, capability_token, expires_at, seed_version_id
        from private.create_demo_session(${DEMO_SEED_CODE}, 'LIVE', interval '2 hours')`;
  } catch (error) {
    // 승인된 Seed 가 없으면 함수가 no_data_found 로 멈춘다. 그때는 그 사실을 적는다.
    if (String((error as { code?: string })?.code ?? "") === "P0002") {
      throw new DemoUnavailableError("공개 Demo 자료가 아직 올라가지 않았습니다");
    }
    throw error;
  }
  const row = rows[0];
  if (!row) throw new DemoUnavailableError("공개 Demo 자료가 아직 올라가지 않았습니다");
  return {
    sessionId: row.session_id as string,
    capabilityToken: row.capability_token as string,
    expiresAt: new Date(row.expires_at as string).toISOString(),
    seedVersionId: row.seed_version_id as string,
  };
};

export const readSeed = async (
  sql: Sql, seedVersionId: string,
): Promise<{ maskedInput: string; version: string; claims: ConfirmedClaim[]; sourceSnapshotIds: string[] }> => {
  const rows = await sql`
    select version, masked_input, expected_claim_manifest
      from demo.seed_versions where id = ${seedVersionId}::uuid`;
  const row = rows[0];
  if (!row) throw new DemoUnavailableError("Demo Seed 를 읽지 못했습니다");
  const manifest = row.expected_claim_manifest as { claims?: unknown };
  const claims = Array.isArray(manifest.claims) ? manifest.claims : [];
  const sourceRows = await sql`
    select source_snapshot_id
      from demo.seed_sources
     where seed_version_id = ${seedVersionId}::uuid
     order by purpose_code, source_snapshot_id`;
  if (sourceRows.length === 0) {
    throw new DemoUnavailableError("Demo 공식 자료 연결을 확인하지 못했습니다");
  }
  return {
    maskedInput: row.masked_input as string,
    version: row.version as string,
    claims: claims.map((claim, index) => {
      const value = claim as Record<string, unknown>;
      return {
        claim_ref: `D${index + 1}`,
        claim_type: String(value.claim_type ?? "PRODUCT_TERM") as ConfirmedClaim["claim_type"],
        statement_masked: String(value.statement_masked ?? ""),
        materiality: String(value.materiality ?? "MATERIAL") as ConfirmedClaim["materiality"],
      };
    }),
    sourceSnapshotIds: sourceRows.map((source) => source.source_snapshot_id as string),
  };
};

/**
 * Demo 기록기.
 *
 * 회원 표에는 한 줄도 쓰지 않는다. Tool 기록의 인용 이름은 그대로 되돌려 준다.
 * Demo 는 근거 행을 만들지 않고 결과 Snapshot 안에 근거를 함께 담기 때문이다.
 */
export const demoRecorder = (sql: Sql, demoRunId: string): RunRecorder => ({
  agentRun: async (args) => {
    const rows = await sql`
      insert into demo.agent_runs
        (demo_run_id, agent_code, version, status, tool_summary, started_at, finished_at)
      values (${demoRunId}::uuid, ${args.agentCode}, ${args.version},
              ${args.status}::public.execution_status,
              ${sql.json({ schema_version: "1", tool_calls: args.toolCalls,
                           evidence_count: args.evidenceCount, finding_count: args.findingCount,
                           reason_code: args.reasonCode })},
              ${new Date(args.startedAt).toISOString()}, ${new Date(args.finishedAt).toISOString()})
      returning id`;
    return rows[0].id as string;
  },
  toolRuns: async (agentRunId: string, pendings: PendingToolRun[]) => {
    const ids = new Map<string, string>();
    for (const pending of pendings) {
      const spec = TOOLS.find((tool) => tool.toolCode === pending.toolCode);
      const rows = await sql`
        insert into demo.tool_runs (demo_agent_run_id, tool_code, transport, status, started_at, finished_at)
        values (${agentRunId}::uuid, ${pending.toolCode},
                ${spec?.transport ?? "FUNCTION"}::public.tool_transport,
                ${pending.status}::public.execution_status,
                ${new Date(pending.startedAt).toISOString()},
                ${new Date(pending.finishedAt).toISOString()})
        returning id`;
      const toolRunId = rows[0].id as string;
      for (const item of pending.items) {
        // 인용 이름은 그대로 쓴다. Demo 는 근거 행 대신 Snapshot 에 근거를 담는다.
        ids.set(item.ref, item.ref);
        const snapshotId = item.item.storedSnapshotId
          ?? await recordSnapshot(sql, item.item, pending.toolCode, demoRunId);
        await sql`
          insert into demo.tool_run_sources (demo_tool_run_id, source_snapshot_id)
          values (${toolRunId}::uuid, ${snapshotId}::uuid)
          on conflict do nothing`;
      }
    }
    return ids;
  },
});

export const runDemo = async (args: {
  sql: Sql;
  session: DemoSession;
  signal?: AbortSignal;
  progress?: RunProgress;
}): Promise<{ demoRunId: string; manifest: Record<string, unknown> }> => {
  const { sql, session } = args;
  const seed = await readSeed(sql, session.seedVersionId);
  const manifest = await loadManifest(sql);

  const created = await sql`
    insert into demo.runs (session_id, execution_manifest_id, status, started_at)
    values (${session.sessionId}::uuid, ${manifest.manifestId}::uuid, 'RUNNING', now())
    returning id`;
  const demoRunId = created[0].id as string;

  try {
    const run = await runVerification({
      ctx: {
        sql,
        // Demo 는 회원 자료를 만들지 않는다. 이 두 값은 회원 표에 닿지 않는다.
        ownerId: session.sessionId,
        caseId: session.sessionId,
        runId: demoRunId,
        manifest,
        signal: args.signal,
        recorder: demoRecorder(sql, demoRunId),
        allowedSourceSnapshotIds: seed.sourceSnapshotIds,
      },
      claims: seed.claims,
      maskedIntake: seed.maskedInput,
      journeyStage: "PRE_TRANSACTION",
      agentModel: createAgentModel({sql,demoRunId}),
      judgeModel: createJudgeModel({sql,demoRunId}),
      progress: args.progress,
    });

    // 회원 Run 과 같은 최종화 규칙을 쓴다. 독립 재확인이 확인하지 못한 중요 Claim 은
    // 확정하지 않고 낮춘다 (규칙 3). Demo 기록기는 인용 이름을 그대로 근거 ID 로 쓴다.
    const finals = buildFinalClaims({
      claims: seed.claims.map((claim) => ({ ...claim, claimId: claim.claim_ref })),
      run,
    });
    const axes = buildAxisResults(finals, false);
    // 행동 안내 실패는 회원 Run 처럼 결과를 막지 않는다. 안내 없이 한계로 남긴다.
    const guide = await buildActionGuide(sql, finals).then((built) => built.display).catch(() => null);
    const isMaterial = (claimId: string) =>
      seed.claims.find((claim) => claim.claim_ref === claimId)?.materiality === "MATERIAL";
    const inputs = overallInputs({
      finals, isMaterial,
      // Manifest 의 일곱 Agent 가 모두 필수다. Judge 실패도 부분 실행으로 센다.
      agentPartial: run.partial,
      guideActionCodes: guide?.actions.map((action) => action.action_code) ?? [],
    });
    // 결과 범주는 회원 Passport 와 같은 DB 함수가 정한다. 없는 낱말을 만들지 않는다 (RES-002).
    const [decided] = await sql`
      select private.decide_overall_result(
        ${inputs.materialContradicted}::boolean, ${inputs.highRisk}::boolean,
        ${inputs.nonMaterialContradicted}::boolean, ${inputs.materialConflict}::boolean,
        ${inputs.materialUndecided}::boolean, ${inputs.agentPartial}::boolean,
        ${inputs.coverageSatisfied}::boolean, ${inputs.preActionRemaining}::boolean) as overall`;
    const overall = String(decided.overall);

    const payload = {
      schema_version: RESULT_SCHEMA_VERSION,
      seed_code: DEMO_SEED_CODE,
      seed_version: seed.version,
      partial: run.partial,
      overall_result: overall,
      axes,
      guide,
      agents: run.agentResults.map((entry) => ({
        agent_code: entry.agentCode, status: entry.status, tool_calls: entry.toolCalls,
        reason_code: entry.reasonCode ?? null,
      })),
      judge_reason_code: run.judgeReasonCode,
      claims: seed.claims.map((claim) => {
        const settled = finals.find((entry) => entry.claim_id === claim.claim_ref);
        return {
          claim_ref: claim.claim_ref,
          statement_masked: claim.statement_masked,
          materiality: claim.materiality,
          state: settled?.status ?? "UNKNOWN",
          reason_code: settled?.reason_code ?? null,
          cove_status: settled?.cove_status ?? null,
          red_team_status: settled?.red_team_status ?? null,
          rationale_masked: settled?.decision_summary_masked ?? "확인하지 못했습니다.",
          evidence_refs: settled?.evidences.map((entry) => entry.evidence_id) ?? [],
          relations: Object.fromEntries(settled?.evidences.map((entry) => [entry.evidence_id, entry.relation]) ?? []),
        };
      }),
      evidence: run.evidence.map((item) => ({
        ref: item.evidence_ref, title: item.title, source: item.source_type,
        grade: item.authority_grade, official_id: item.official_id, url: item.url,
        published_at: item.published_at, fetched_at: item.fetched_at,
        content_hash: item.content_hash, freshness: item.freshness_at_use,
        directness: item.directness, reference_only: item.reference_only,
        excerpt: item.excerpt_masked,
      })),
    };

    await sql`
      update demo.runs
         set status = ${run.partial ? "PARTIAL" : "SUCCEEDED"}::public.execution_status,
             overall_result = ${overall}::public.overall_result, finished_at = now()
       where id = ${demoRunId}::uuid`;
    await sql`
      insert into demo.result_snapshots (demo_run_id, result_manifest, computed_at, basis_date,
                                         is_precomputed, content_hash)
      values (${demoRunId}::uuid, ${JSON.stringify(payload)}::text::jsonb, now(), current_date,
              false, ${sha256(JSON.stringify(payload))})`;
    return { demoRunId, manifest: payload };
  } catch (error) {
    await sql`
      update demo.runs set status = 'FAILED', finished_at = now(), error_code = 'RUN_FAILED'
       where id = ${demoRunId}::uuid`.catch(() => undefined);
    throw error;
  }
};
