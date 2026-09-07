import "server-only";
import { z } from "zod";
import type postgres from "postgres";
import { gateForModel } from "@/lib/agents/pii";
import { confirmedClaim } from "./schemas";

export const selectionSchema = z.object({
  case_id: z.uuid(),
  replace_run_id: z.uuid().optional(),
  claims: z.array(z.object({
    claim_id: z.uuid(), statement_masked: z.string().trim().min(1).max(400).optional(),
    expected_revision_no: z.number().int().positive().optional(),
  })).min(1).max(8),
});

type Sql = ReturnType<typeof postgres> | postgres.TransactionSql;

/**
 * 초기 검증 시작 전 Case를 INPUT_REVIEW로 맞춘다. 0045가 적용된 DB에서는
 * 원자 함수를 쓰고, 배포와 Migration 사이의 짧은 구간에는 기존 잠금 함수를
 * 조합한다. 어느 경로도 타인·다른 Case의 Run ID로 실행을 끝내지 않는다.
 */
export async function prepareInitialVerificationStart(
  sql: Sql, ownerId: string, caseId: string, replaceRunId?: string,
): Promise<void> {
  const [available] = await sql`
    select to_regprocedure('private.prepare_initial_verification_retry(uuid,uuid,uuid)') is not null as ok`;
  if (available?.ok) {
    await sql`select private.prepare_initial_verification_retry(${ownerId}::uuid,${caseId}::uuid,
      ${replaceRunId ?? null}::uuid)`;
    return;
  }

  // 0045 전환 구간의 호환 경로다. 소유권과 Case를 먼저 좁힌 뒤 기존
  // fail_verification_run이 다시 행을 잠그고 활성 상태인지 확인한다.
  const active = await sql`
    select id,deadline_at<=now() as expired from public.verification_runs
     where owner_id=${ownerId}::uuid and case_id=${caseId}::uuid and kind='INITIAL'
       and status in ('QUEUED','RUNNING') order by created_at desc limit 1`;
  if (active.length) {
    const exactRetry = replaceRunId === active[0].id;
    if (!active[0].expired && !exactRetry) {
      throw Object.assign(new Error("다른 초기 검증이 아직 실행 중이다"), { code: "23505" });
    }
    await sql`select private.fail_verification_run(${active[0].id}::uuid,
      ${active[0].expired ? "DEADLINE_EXCEEDED" : "CLIENT_RETRY"},null)`;
  }
  const cases = await sql`
    select lifecycle from public.financial_cases
     where id=${caseId}::uuid and owner_id=${ownerId}::uuid and deleted_at is null`;
  if (!cases.length) throw Object.assign(new Error("Case 접근 불가"), { code: "42501" });
  if (cases[0].lifecycle === "DRAFT") {
    await sql`select private.transition_financial_case(${ownerId}::uuid,${caseId}::uuid,
      'INPUT_REVIEW'::public.case_lifecycle,'USER','CLAIMS_CONFIRMED')`;
  } else if (cases[0].lifecycle !== "INPUT_REVIEW") {
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
