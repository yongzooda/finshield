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
import type { PendingToolRun, RunRecorder } from "./tools/runtime";
import type { ConfirmedClaim } from "./schemas";

type Sql = ReturnType<typeof postgres>;

export const DEMO_SEED_CODE = "sunshine-loan-15";
export const RESULT_SCHEMA_VERSION = "demo-result-v1";

export type DemoSession = {
  sessionId: string;
  capabilityToken: string;
  expiresAt: string;
  seedVersionId: string;
};

export class DemoUnavailableError extends Error {}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** 이 방문자가 최근에 얼마나 돌렸는지 본다. 공개 경로라 상한이 필요하다. */
export const allowDemo = async (sql: Sql, visitorKey: string): Promise<boolean> => {
  const rows = await sql`
    select allowed from private.consume_rate_limit('DEMO', ${visitorKey}, 'DEMO_RUN', 3, 3600)`;
  return rows[0]?.allowed === true;
};

export const createSession = async (sql: Sql): Promise<DemoSession> => {
  const rows = await sql`
    select session_id, capability_token, expires_at, seed_version_id
      from private.create_demo_session(${DEMO_SEED_CODE}, 'LIVE', interval '2 hours')`;
  const row = rows[0];
  if (!row) throw new DemoUnavailableError("Demo Seed 가 아직 올라가지 않았습니다");
  return {
    sessionId: row.session_id as string,
    capabilityToken: row.capability_token as string,
    expiresAt: new Date(row.expires_at as string).toISOString(),
    seedVersionId: row.seed_version_id as string,
  };
};

export const readSeed = async (
  sql: Sql, seedVersionId: string,
): Promise<{ maskedInput: string; version: string; claims: ConfirmedClaim[] }> => {
  const rows = await sql`
    select version, masked_input, expected_claim_manifest
      from demo.seed_versions where id = ${seedVersionId}::uuid`;
  const row = rows[0];
  if (!row) throw new DemoUnavailableError("Demo Seed 를 읽지 못했습니다");
  const manifest = row.expected_claim_manifest as { claims?: unknown };
  const claims = Array.isArray(manifest.claims) ? manifest.claims : [];
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
  };
};

/**
 * Demo 기록기.
 *
 * 회원 표에는 한 줄도 쓰지 않는다. Tool 기록의 인용 이름은 그대로 되돌려 준다.
 * Demo 는 근거 행을 만들지 않고 결과 Snapshot 안에 근거를 함께 담기 때문이다.
 */
const demoRecorder = (sql: Sql, demoRunId: string): RunRecorder => ({
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
        const snapshotId = item.item.locator?.snapshot_id;
        if (typeof snapshotId === "string") {
          await sql`
            insert into demo.tool_run_sources (demo_tool_run_id, source_snapshot_id)
            values (${toolRunId}::uuid, ${snapshotId}::uuid)
            on conflict do nothing`.catch(() => undefined);
        }
      }
    }
    return ids;
  },
});

export const runDemo = async (args: {
  sql: Sql;
  session: DemoSession;
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
        recorder: demoRecorder(sql, demoRunId),
      },
      claims: seed.claims,
      maskedIntake: seed.maskedInput,
      journeyStage: "PRE_TRANSACTION",
      agentModel: createAgentModel(),
      judgeModel: createJudgeModel(),
      progress: args.progress,
    });

    const results = run.judgeOutput?.claim_results ?? [];
    // 결과 범주는 Enum 에 있는 값만 쓴다. 없는 낱말을 만들지 않는다 (RES-002).
    const overall = results.some((entry) => entry.state === "CONTRADICTED") ? "MATERIAL_RISK_FOUND"
      : results.some((entry) => entry.state === "CONFLICT") ? "VERIFY_BEFORE_PROCEEDING"
        : results.length > 0 && results.every((entry) => entry.state === "VERIFIED")
          ? "NO_SPECIAL_RISK_IN_VERIFIED_SCOPE"
          : "INSUFFICIENT_INFORMATION";

    const payload = {
      schema_version: RESULT_SCHEMA_VERSION,
      seed_code: DEMO_SEED_CODE,
      seed_version: seed.version,
      partial: run.partial,
      agents: run.agentResults.map((entry) => ({
        agent_code: entry.agentCode, status: entry.status, tool_calls: entry.toolCalls,
      })),
      claims: seed.claims.map((claim) => {
        const judged = results.find((entry) => entry.claim_ref === claim.claim_ref);
        return {
          claim_ref: claim.claim_ref,
          statement_masked: claim.statement_masked,
          state: judged?.state ?? "UNKNOWN",
          rationale_masked: judged?.rationale_masked ?? "확인하지 못했습니다.",
          evidence_refs: judged?.evidence_refs ?? [],
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
