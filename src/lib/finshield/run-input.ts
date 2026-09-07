import "server-only";
import { z } from "zod";
import type postgres from "postgres";
import { gateForModel } from "@/lib/agents/pii";
import { confirmedClaim } from "./schemas";

export const selectionSchema = z.object({
  case_id: z.uuid(),
  claims: z.array(z.object({
    claim_id: z.uuid(), statement_masked: z.string().trim().min(1).max(400).optional(),
    expected_revision_no: z.number().int().positive().optional(),
  })).min(1).max(8),
});

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
