/**
 * Agent 입력·출력 Schema.
 *
 * 규칙 1 이 요구하는 「근거 없는 판단 금지」를 코드로 강제하는 자리다.
 * Domain Agent 는 자기가 부른 Tool 이 돌려준 근거의 식별자만 인용할 수 있다.
 * 모델이 지어낸 식별자는 검증에서 걸러져 출력 자체가 거부된다.
 *
 * 상태값은 DB enum 과 같은 낱말을 쓴다. UNKNOWN 은 근거 부족이고
 * NEED_MORE_INFORMATION 은 사용자 정보 부족이라 서로 바꿔 쓰지 않는다 (EV-011).
 */

import { z } from "zod";

export const CLAIM_STATES = [
  "VERIFIED", "CONTRADICTED", "CONFLICT", "UNKNOWN", "NEED_MORE_INFORMATION", "WITHHELD",
] as const;
export const claimState = z.enum(CLAIM_STATES);
export type ClaimState = z.infer<typeof claimState>;

export const evidenceRelation = z.enum(["SUPPORT", "CONTRADICT", "CONTEXT"]);
export const evidenceDirectness = z.enum(["DIRECT", "INDIRECT", "CONTEXT_ONLY"]);
export const freshness = z.enum(["FRESH", "STALE", "UNKNOWN"]);

/** Tool 이 돌려준 근거 한 건. 모델은 이것을 만들지 못하고 참조만 한다. */
export const toolEvidence = z.object({
  evidence_ref: z.string().regex(/^E[0-9]{1,3}$/),
  tool_code: z.string(),
  source_type: z.string(),
  // A 는 법령·공시 같은 1차 공식 자료, B 는 공식 기관의 안내, C 는 참고 자료다.
  authority_grade: z.enum(["A", "B", "C"]),
  title: z.string(),
  official_id: z.string().nullable(),
  url: z.string().nullable(),
  locator: z.record(z.string(), z.unknown()),
  published_at: z.string().nullable(),
  fetched_at: z.string(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/),
  excerpt_masked: z.string(),
  // EV-006: 같은 원문을 다시 실은 자료는 독립 근거로 세지 않는다.
  independence_key: z.string(),
  // EV-007: 유사 사례는 현재 거래의 위법·사기를 증명하지 않는다.
  reference_only: z.boolean(),
  citable: z.boolean(),
  incomplete: z.boolean(),
  freshness_at_use: freshness,
  directness: evidenceDirectness,
});
export type ToolEvidence = z.infer<typeof toolEvidence>;

/** 사용자가 확인한 Claim 하나. 원문이 아니라 마스킹된 문장만 담는다. */
export const confirmedClaim = z.object({
  claim_ref: z.string().regex(/^C[0-9]{1,3}$/),
  claim_type: z.string(),
  statement_masked: z.string(),
  materiality: z.enum(["MATERIAL", "NON_MATERIAL", "UNDETERMINED"]),
});
export type ConfirmedClaim = z.infer<typeof confirmedClaim>;

export const domainAgentInput = z.object({
  schema_version: z.literal("in-v1"),
  agent_code: z.string(),
  scenario: z.literal("LOAN"),
  journey_stage: z.enum(["PRE_TRANSACTION", "ENROLLED", "FUNDS_SENT_OR_DAMAGE_SUSPECTED"]),
  claims: z.array(confirmedClaim).min(1),
  masked_intake: z.string(),
});
export type DomainAgentInput = z.infer<typeof domainAgentInput>;

export const domainFinding = z.object({
  claim_ref: z.string(),
  state: claimState,
  relation: evidenceRelation,
  // 인용한 근거. 비어 있으면 확정 상태를 쓸 수 없다.
  evidence_refs: z.array(z.string()),
  summary_masked: z.string().min(1).max(600),
  limits: z.array(z.string().max(200)).max(5),
});
export type DomainFinding = z.infer<typeof domainFinding>;

export const domainAgentOutput = z.object({
  schema_version: z.literal("out-v1"),
  findings: z.array(domainFinding),
  // 이 Agent 의 범위 밖이라 손대지 않은 Claim.
  out_of_scope_claim_refs: z.array(z.string()),
});
export type DomainAgentOutput = z.infer<typeof domainAgentOutput>;

export const judgeInput = z.object({
  schema_version: z.literal("in-v1"),
  claims: z.array(confirmedClaim).min(1),
  // AI-013: 원문은 넣지 않는다. Domain Agent 가 만든 구조만 본다.
  findings: z.array(domainFinding.extend({ agent_code: z.string() })),
  evidences: z.array(toolEvidence),
});
export type JudgeInput = z.infer<typeof judgeInput>;

export const judgeOutput = z.object({
  schema_version: z.literal("out-v1"),
  claim_results: z.array(z.object({
    claim_ref: z.string(),
    state: claimState,
    evidence_refs: z.array(z.string()),
    // 확정하지 않은 이유를 남긴다. EV-012 가 요구하는 보류 사유다.
    withheld_reason: z.string().max(200).nullable(),
    rationale_masked: z.string().min(1).max(600),
  })).min(1),
  conflicts: z.array(z.object({
    claim_ref: z.string(),
    // EV-005: 충돌하는 공식 자료는 평균 내지 않고 둘 다 남긴다.
    evidence_refs: z.array(z.string()).min(2),
    note_masked: z.string().max(400),
  })),
});
export type JudgeOutput = z.infer<typeof judgeOutput>;

/**
 * 모델 출력이 인용한 근거가 실제로 존재하는지 확인한다.
 *
 * 규칙 1 의 기계적 강제다. 이 검사를 통과하지 못한 출력은 화면에 가지 않는다.
 * 확정 상태(VERIFIED·CONTRADICTED)에는 근거가 최소 하나 있어야 하고,
 * 그 근거는 참고용이 아니어야 한다 (EV-007, EV-008).
 */
export const citationProblems = (
  refs: string[],
  state: ClaimState,
  pool: Map<string, ToolEvidence>,
): string[] => {
  const problems: string[] = [];
  for (const ref of refs) {
    if (!pool.has(ref)) problems.push(`없는 근거를 인용했습니다: ${ref}`);
  }
  const known = refs.filter((ref) => pool.has(ref)).map((ref) => pool.get(ref) as ToolEvidence);
  if ((state === "VERIFIED" || state === "CONTRADICTED") && known.length === 0) {
    problems.push("근거 없이 확정 상태를 썼습니다.");
  }
  if ((state === "VERIFIED" || state === "CONTRADICTED") && known.every((item) => item.reference_only)) {
    problems.push("참고용 자료만으로 확정 상태를 썼습니다.");
  }
  if ((state === "VERIFIED" || state === "CONTRADICTED") && !known.some(item =>
    item.citable && !item.incomplete && !item.reference_only
    && item.freshness_at_use === "FRESH" && item.directness === "DIRECT")) {
    problems.push("완전하고 유효한 직접 판단 근거가 없습니다.");
  }
  return problems;
};

/** EV-006: 같은 원문에서 나온 근거는 하나로 센다. */
export const independentCount = (refs: string[], pool: Map<string, ToolEvidence>): number => {
  const keys = new Set<string>();
  for (const ref of refs) {
    const item = pool.get(ref);
    if (item) keys.add(item.independence_key);
  }
  return keys.size;
};

/** CoVe 결과. 확인·반증·판단 불가 셋뿐이다. */
export const coveStatus = z.enum(["CONFIRMED", "REFUTED", "INCONCLUSIVE"]);
export const coveOutput = z.object({
  schema_version: z.literal("out-v1"),
  results: z.array(z.object({
    claim_ref: z.string(),
    status: coveStatus,
    evidence_refs: z.array(z.string()),
    note_masked: z.string().max(400),
  })),
});
export type CoveOutput = z.infer<typeof coveOutput>;

/** Red Team 결과. 반대 근거를 찾았는지만 말한다. */
export const redTeamStatus = z.enum(["COUNTER_EVIDENCE", "NONE_FOUND"]);
export const redTeamOutput = z.object({
  schema_version: z.literal("out-v1"),
  results: z.array(z.object({
    claim_ref: z.string(),
    status: redTeamStatus,
    evidence_refs: z.array(z.string()),
    note_masked: z.string().max(400),
  })),
});
export type RedTeamOutput = z.infer<typeof redTeamOutput>;
