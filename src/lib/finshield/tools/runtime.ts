/**
 * Tool 실행과 근거 기록.
 *
 * 이 모듈이 규칙 1 의 물리적 경계다. Evidence 는 오직 Tool 이 돌려준 값에서만
 * 만들어진다. 모델이 쓴 문장은 이 경로를 지나지 못한다.
 *
 * 기록 순서도 계약이다. Tool 결과가 먼저 `public.tool_runs` 에 남고, 그 행의
 * `provenance_complete` 가 참일 때만 `public.evidences` 가 그것을 가리킬 수 있다.
 * Provenance 가 불완전한 결과가 근거가 되는 일을 DB trigger 가 막는다.
 *
 * Allowlist 는 여기서도 보고 DB trigger 도 본다. 코드가 틀려도 기록이 남지 않는다.
 */

import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { AGENTS, TOOLS } from "../manifest";
import type { ResolvedManifest } from "../registry";
import type { ToolEvidence } from "../schemas";

type Sql = ReturnType<typeof postgres>;

export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Tool 이 외부에서 가져온 자료 한 건. 여기에 없는 값은 근거가 될 수 없다. */
export type SourceItem = {
  sourceType: string;
  authorityGrade: "A" | "B" | "C";
  publisher: string;
  title: string;
  officialId: string | null;
  canonicalUrl: string | null;
  lawName?: string | null;
  articleNo?: string | null;
  publishedAt: string | null;
  effectiveFrom?: string | null;
  sourceVersion: string | null;
  /** 원문 그대로의 해시. 같은 원문이면 같은 값이어야 한다. */
  contentHash: string;
  /** EV-006 의 Source Fingerprint. 재게시본은 원본과 같은 값을 쓴다. */
  fingerprint: string;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  licenseCode: string | null;
  isComplete: boolean;
  isCitable: boolean;
  locator: Record<string, unknown>;
  excerptMasked: string;
  directness: "DIRECT" | "INDIRECT" | "CONTEXT_ONLY";
  /** EV-007: 유사 사례는 참고용이다. 현재 거래의 위법을 증명하지 않는다. */
  referenceOnly: boolean;
  selectionReasonCode: string;
};

export type ToolOutcome = {
  /**
   * 공식 출처에서 나온 것만 여기 담는다. Snapshot 이 되고 근거가 된다.
   * 사용자가 낸 문자열을 뜯어 본 사실 같은 것은 근거가 아니라 맥락이다.
   */
  items: SourceItem[];
  /** 근거가 아닌 관측. 실행 기록에 남고 Agent 입력의 맥락으로만 쓰인다. */
  observations?: Record<string, unknown>;
  /** 출처·시각·해시가 모두 갖춰졌는가. 거짓이면 근거로 쓰지 못한다. */
  provenanceComplete: boolean;
  candidateCount: number;
  errorCode?: string | null;
  reasonCode?: string | null;
};

export type ToolImpl = (input: unknown, ctx: ToolCallContext) => Promise<ToolOutcome>;

export type ToolCallResult = {
  evidence: ToolEvidence[];
  observations: Record<string, unknown> | null;
};

export type ToolCallContext = {
  sql: Sql;
  ownerId: string;
  caseId: string;
  runId: string;
  manifest: ResolvedManifest;
};

export type RunSession = ToolCallContext & {
  /** 이 Run 안에서 근거에 붙는 이름. 모델은 이 이름으로만 인용한다. */
  evidence: Map<string, ToolEvidence>;
  nextEvidenceNo: () => string;
};

export const createRunSession = (ctx: ToolCallContext): RunSession => {
  let counter = 0;
  return {
    ...ctx,
    evidence: new Map<string, ToolEvidence>(),
    nextEvidenceNo: () => `E${(counter += 1)}`,
  };
};

const toolSpec = (toolCode: string) => {
  const spec = TOOLS.find((tool) => tool.toolCode === toolCode);
  if (!spec) throw new Error(`등록되지 않은 Tool 이다: ${toolCode}`);
  return spec;
};

const assertAllowed = (agentCode: string, toolCode: string, purposeCode: string) => {
  const agent = AGENTS.find((item) => item.agentCode === agentCode);
  const allowed = agent?.tools.some((tool) => tool.toolCode === toolCode && tool.purposeCode === purposeCode);
  if (!allowed) {
    throw new Error(`${agentCode} 는 ${toolCode} 를 ${purposeCode} 목적으로 부를 수 없다`);
  }
};

/**
 * 조회한 출처를 Snapshot 으로 남긴다. kb 표는 적재 역할의 것이라 worker 가 직접
 * 쓰지 못하고 함수로만 쓴다. 같은 원문이면 행이 늘지 않고 조회 시각만 갱신된다.
 */
const recordSnapshot = async (
  sql: Sql, item: SourceItem, toolCode: string, runId: string,
): Promise<string> => {
  const rows = await sql`
    select private.record_source_snapshot(
      ${item.sourceType}, ${item.authorityGrade}::public.authority_level, ${item.publisher},
      ${item.title}, ${item.canonicalUrl}, ${item.officialId}, ${item.lawName ?? null},
      ${item.articleNo ?? null}, ${item.publishedAt}, ${item.effectiveFrom ?? null},
      ${item.sourceVersion}, ${item.contentHash}, ${item.fingerprint},
      ${item.freshness}::public.freshness_status, ${item.licenseCode}, ${item.isComplete},
      ${item.isCitable}, ${toolCode},
      ${`${runId}:${item.officialId ?? item.contentHash}`}) as id`;
  return rows[0].id as string;
};

/** 아직 기록하지 않은 Tool 실행 하나. 끝난 뒤 Agent 기록과 함께 남긴다. */
export type PendingToolRun = {
  toolCode: string;
  purposeCode: string;
  input: unknown;
  startedAt: number;
  finishedAt: number;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  provenanceComplete: boolean;
  candidateCount: number;
  errorCode: string | null;
  reasonCode: string | null;
  observations: Record<string, unknown> | null;
  /** 근거가 될 자료와 그것에 미리 붙인 인용 이름. */
  items: { ref: string; item: SourceItem }[];
};

/**
 * Tool 을 실행하고 결과를 메모리에 모은다. 여기서는 DB 에 쓰지 않는다.
 *
 * `public.tool_runs` 와 `public.evidences` 는 worker 에게 INSERT 만 열려 있다.
 * 실행 기록은 고쳐 쓰는 값이 아니라 끝난 사실이라는 뜻이다. 그래서 도는 동안에는
 * 아무것도 남기지 않고, 결과가 정해진 뒤 Agent 기록과 함께 한 번에 남긴다.
 */
export const executeTool = async (
  session: RunSession,
  agentCode: string,
  toolCode: string,
  purposeCode: string,
  input: unknown,
  impl: ToolImpl,
): Promise<{ pending: PendingToolRun; evidence: ToolEvidence[] }> => {
  assertAllowed(agentCode, toolCode, purposeCode);
  toolSpec(toolCode);
  const startedAt = Date.now();

  let outcome: ToolOutcome | null = null;
  let errorCode: string | null = null;
  try {
    outcome = await impl(input, session);
  } catch (error) {
    errorCode = String((error as { code?: string })?.code ?? "TOOL_ERROR")
      .replace(/[^A-Za-z0-9_]/g, "").slice(0, 64) || "TOOL_ERROR";
  }

  const status = errorCode ? "FAILED" : outcome?.errorCode ? "PARTIAL" : "SUCCEEDED";
  const provenanceComplete = errorCode ? false : outcome?.provenanceComplete === true;
  const pending: PendingToolRun = {
    toolCode, purposeCode, input, startedAt, finishedAt: Date.now(), status,
    provenanceComplete, candidateCount: outcome?.candidateCount ?? 0,
    errorCode: errorCode ?? outcome?.errorCode ?? null,
    reasonCode: outcome?.reasonCode ?? (errorCode ? "TOOL_EXECUTION_FAILED" : null),
    observations: outcome?.observations ?? null,
    items: [],
  };

  // Provenance 가 불완전하면 근거를 만들지 않는다. 결과가 있었다는 사실만 남는다.
  // 도구 실패도 안전 판정이 아니다. 부르는 쪽이 UNKNOWN 으로 다뤄야 한다.
  if (errorCode || !outcome || !provenanceComplete) return { pending, evidence: [] };

  const evidence: ToolEvidence[] = [];
  for (const item of outcome.items) {
    const ref = session.nextEvidenceNo();
    pending.items.push({ ref, item });
    const record: ToolEvidence = {
      evidence_ref: ref,
      tool_code: toolCode,
      source_type: item.sourceType,
      authority_grade: item.authorityGrade,
      title: item.title,
      official_id: item.officialId,
      url: item.canonicalUrl,
      locator: item.locator,
      published_at: item.publishedAt,
      fetched_at: new Date().toISOString(),
      content_hash: item.contentHash,
      excerpt_masked: item.excerptMasked,
      independence_key: item.fingerprint,
      reference_only: item.referenceOnly,
      freshness_at_use: item.freshness,
      directness: item.directness,
    };
    session.evidence.set(ref, record);
    evidence.push(record);
  }
  return { pending, evidence };
};

/** Agent 기록에 딸린 Tool 실행과 근거를 한 번에 남긴다. */
export const persistToolRuns = async (
  session: RunSession,
  agentRunId: string,
  pendings: PendingToolRun[],
): Promise<void> => {
  const { sql, ownerId, caseId, runId } = session;
  // 시도 번호는 이 Agent 실행 안에서 이어진다. 이미 남은 행이 있으면 그 뒤부터 센다.
  const existing = await sql`
    select logical_tool_key, count(*)::int as n from public.tool_runs
     where agent_run_id = ${agentRunId}::uuid group by logical_tool_key`;
  const attempts = new Map<string, number>(
    existing.map((row) => [row.logical_tool_key as string, row.n as number]));
  for (const pending of pendings) {
    const spec = toolSpec(pending.toolCode);
    const attemptNo = (attempts.get(pending.toolCode) ?? 0) + 1;
    attempts.set(pending.toolCode, attemptNo);
    const created = await sql`
      insert into public.tool_runs
        (owner_id, case_id, verification_run_id, agent_run_id, logical_tool_key, tool_code, tool_version,
         transport, attempt_no, status, input_schema_version, output_schema_version, request_hash,
         sanitized_scope, provenance_complete, candidate_count, selected_count, result_digest,
         started_at, finished_at, latency_ms, error_code, reason_code)
      values (${ownerId}::uuid, ${caseId}::uuid, ${runId}::uuid, ${agentRunId}::uuid, ${pending.toolCode},
              ${pending.toolCode}, ${spec.version}, ${spec.transport}::public.tool_transport, ${attemptNo},
              ${pending.status}::public.execution_status, ${spec.inputSchemaVersion}, ${spec.outputSchemaVersion},
              ${sha256(JSON.stringify(pending.input ?? null))},
              ${sql.json(JSON.parse(JSON.stringify({ schema_version: "1", purpose_code: pending.purposeCode, observations: pending.observations })))},
              ${pending.provenanceComplete}, ${pending.candidateCount}, ${pending.items.length},
              ${sha256(JSON.stringify(pending.items.map((entry) => entry.item.contentHash)))},
              ${new Date(pending.startedAt).toISOString()}, ${new Date(pending.finishedAt).toISOString()},
              ${pending.finishedAt - pending.startedAt}, ${pending.errorCode}, ${pending.reasonCode})
      returning id`;
    const toolRunId = created[0].id as string;

    for (const { item } of pending.items) {
      const snapshotId = await recordSnapshot(sql, item, pending.toolCode, runId);
      const citable = item.isCitable && item.isComplete && !item.referenceOnly;
      await sql`
        insert into public.evidences
          (owner_id, case_id, verification_run_id, kb_snapshot_id, produced_by_tool_run_id, source_locator,
           excerpt_masked, directness, citable, reference_only, incomplete, freshness_at_use, target_match,
           independence_key, selection_reason_code, content_hash)
        values (${ownerId}::uuid, ${caseId}::uuid, ${runId}::uuid, ${snapshotId}::uuid, ${toolRunId}::uuid,
                ${sql.json(JSON.parse(JSON.stringify({ schema_version: "1", ...item.locator })))}, ${item.excerptMasked},
                ${item.directness}::public.evidence_directness, ${citable}, ${item.referenceOnly},
                ${!item.isComplete}, ${item.freshness}::public.freshness_status, true,
                ${item.fingerprint}, ${item.selectionReasonCode}, ${item.contentHash})`;
    }
  }
};
