import "server-only";
import { z } from "zod";
import type postgres from "postgres";
import { gateForModel } from "@/lib/agents/pii";
import { confirmedClaim } from "./schemas";
import { restSelect } from "./rest";

export const selectionSchema = z.object({
  case_id: z.uuid(),
  replace_run_id: z.uuid().optional(),
  claims: z.array(z.object({
    claim_id: z.uuid(), statement_masked: z.string().trim().min(1).max(400).optional(),
    expected_revision_no: z.number().int().positive().optional(),
  })).min(1).max(8),
});

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

const fallbackCaseSchema = z.object({
  lifecycle: z.string(),
  runs: z.array(z.object({
    run_id: z.uuid(),
    kind: z.string(),
    status: z.string(),
    deadline_at: z.string(),
  })),
});

export type InitialVerificationPreparation =
  | { native: true }
  | {
      native: false;
      lifecycle: string;
      activeRun: { run_id: string; deadline_at: string } | null;
    };

/**
 * 0045 적용 전 원격도 안전하게 지원한다. Worker가 소유자 Base table을 직접
 * 읽지 않고, 사용자 JWT에 RLS가 적용된 View에서 Case와 활성 Run만 확인한다.
 */
export async function loadInitialVerificationPreparation(
  sql: Sql, token: string, caseId: string,
): Promise<InitialVerificationPreparation> {
  const [available] = await sql`
    select to_regprocedure('private.prepare_initial_verification_retry(uuid,uuid,uuid)') is not null as ok`;
  if (available?.ok) return { native: true };

  const rows = await restSelect({
    token,
    path: "case_detail_v",
    query: { select: "id,lifecycle,runs", id: `eq.${caseId}` },
  });
  const parsed = fallbackCaseSchema.safeParse(rows[0]);
  if (!parsed.success) throw Object.assign(new Error("Case 접근 불가"), { code: "42501" });
  const active = parsed.data.runs.filter((run) =>
    run.kind === "INITIAL" && (run.status === "QUEUED" || run.status === "RUNNING"));
  if (active.length > 1) throw Object.assign(new Error("활성 초기 검증이 여러 건이다"), { code: "23505" });
  return {
    native: false,
    lifecycle: parsed.data.lifecycle,
    activeRun: active[0] ? { run_id: active[0].run_id, deadline_at: active[0].deadline_at } : null,
  };
}

/**
 * 초기 검증 시작 전 Case를 INPUT_REVIEW로 맞춘다. 0045가 적용된 DB에서는
 * 원자 함수를 쓰고, 배포와 Migration 사이의 짧은 구간에는 기존 잠금 함수를
 * 조합한다. 어느 경로도 타인·다른 Case의 Run ID로 실행을 끝내지 않는다.
 */
export async function prepareInitialVerificationStart(
  sql: Sql, ownerId: string, caseId: string, replaceRunId: string | undefined,
  preparation: InitialVerificationPreparation,
): Promise<void> {
  const resolved = preparation;
  if (resolved.native) {
    await sql`select private.prepare_initial_verification_retry(${ownerId}::uuid,${caseId}::uuid,
      ${replaceRunId ?? null}::uuid)`;
    return;
  }

  // RLS View에서 소유권을 확인한 Run ID만 정의자 함수에 넘긴다. 상태가
  // 사이에 바뀌면 함수가 다시 잠그고 거부하므로 늦은 화면이 다른 Run을 끝내지 않는다.
  const active = resolved.activeRun;
  if (active) {
    const expired = Date.parse(active.deadline_at) <= Date.now();
    const exactRetry = replaceRunId === active.run_id;
    if (!expired && !exactRetry) {
      throw Object.assign(new Error("다른 초기 검증이 아직 실행 중이다"), { code: "23505" });
    }
    await sql`select private.fail_verification_run(${active.run_id}::uuid,
      ${expired ? "DEADLINE_EXCEEDED" : "CLIENT_RETRY"},null)`;
  }
  if (!active && resolved.lifecycle === "DRAFT") {
    await sql`select private.transition_financial_case(${ownerId}::uuid,${caseId}::uuid,
      'INPUT_REVIEW'::public.case_lifecycle,'USER','CLAIMS_CONFIRMED')`;
  } else if (!active && resolved.lifecycle !== "INPUT_REVIEW") {
    throw Object.assign(new Error("초기 검증을 시작할 수 없는 상태다"), { code: "23514" });
  }
}

export function maskSelection(input: z.infer<typeof selectionSchema>) {
  return input.claims.map(claim => {
    if (claim.statement_masked === undefined) return claim;
    const gate = gateForModel(claim.statement_masked);
    if (!gate.ok) throw new Error("PII_RESIDUAL");
    return { ...claim, statement_masked: gate.masked.text };
  });
}

const contextSchema = z.object({
  journey_stage: z.enum(["PRE_TRANSACTION", "ENROLLED", "FUNDS_SENT_OR_DAMAGE_SUSPECTED"]),
  deadline_at: z.string(), profile_version_id: z.uuid().nullable(),
  profile_completeness: z.enum(["SKIPPED", "PARTIAL", "COMPLETE"]).nullable(),
  claims: z.array(confirmedClaim.omit({ claim_ref: true }).extend({ claim_id: z.uuid() })).min(1).max(8),
});

/** 브라우저의 본문·중요도·진행 단계를 실행 입력으로 사용하지 않는다. */
export async function loadRunInput(sql: ReturnType<typeof postgres>, owner: string, caseId: string, runId: string) {
  const rows = await sql`select private.read_run_input(${owner}::uuid, ${caseId}::uuid, ${runId}::uuid) as input`;
  const context = contextSchema.parse(rows[0]?.input);
  const claims = context.claims.map((claim, index) => {
    const gate = gateForModel(claim.statement_masked);
    if (!gate.ok || gate.masked.text !== claim.statement_masked) throw new Error("PII_RESIDUAL");
    return { ...claim, claimId: claim.claim_id, claim_ref: `C${index + 1}` };
  });
  return { ...context, claims };
}
