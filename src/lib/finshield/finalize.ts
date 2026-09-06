/**
 * Run 최종화 — 결과를 남긴다.
 *
 * 규칙 3 이 여기서 값을 가진다. 중요 Claim 은 독립 재확인이 같은 결론에 이르렀을
 * 때만 확정된다. CoVe 가 확인하지 못했으면 확정하지 않고 «확인 못 함» 으로
 * 낮춘다. Red Team 이 반대 근거를 찾았으면 확정 대신 «자료가 엇갈림» 으로 둔다.
 *
 * 낮추는 규칙을 코드에 두는 이유는 모델에게 맡기면 스스로 봐줄 수 있기 때문이다.
 * DB 의 finalize_verification_run 도 같은 조건을 다시 검사한다. 두 곳이 어긋나면
 * 저장 자체가 실패한다.
 */

import "server-only";
import type postgres from "postgres";
import type { ClaimState, ConfirmedClaim, CoveOutput, RedTeamOutput } from "./schemas";
import type { OrchestratedRun } from "./orchestrator";

type Sql = ReturnType<typeof postgres>;

const CONFIRMED_STATES: ClaimState[] = ["VERIFIED", "CONTRADICTED"];

export type FinalClaim = {
  claim_id: string;
  status: ClaimState;
  reason_code: string;
  cove_status: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE" | "NOT_REQUIRED";
  red_team_status: "COUNTER_EVIDENCE" | "NONE_FOUND" | "NOT_REQUIRED";
  decision_summary_masked: string;
  evidences: { evidence_id: string; relation: "SUPPORT" | "CONTRADICT" | "CONTEXT" }[];
};

/**
 * 독립 검증 결과를 반영해 최종 상태를 정한다.
 *
 * 올리지 않는다. 낮추기만 한다. 재확인이 «확인» 이라고 해서 Judge 가 보류한 것을
 * 확정으로 바꾸지 않는다. 두 경로가 모두 확정을 말했을 때만 확정이 남는다.
 */
export const applyIndependentChecks = (
  state: ClaimState,
  isMaterial: boolean,
  cove: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE" | "NOT_REQUIRED",
  redTeam: "COUNTER_EVIDENCE" | "NONE_FOUND" | "NOT_REQUIRED",
): { state: ClaimState; reasonCode: string } => {
  if (!CONFIRMED_STATES.includes(state)) return { state, reasonCode: "AS_JUDGED" };
  if (redTeam === "COUNTER_EVIDENCE") {
    // 반대 근거가 있으면 한쪽으로 정하지 않는다. 양쪽을 보존한다.
    return { state: "CONFLICT", reasonCode: "RED_TEAM_COUNTER_EVIDENCE" };
  }
  if (!isMaterial) return { state, reasonCode: "AS_JUDGED" };
  if (cove === "CONFIRMED") return { state, reasonCode: "COVE_CONFIRMED" };
  if (cove === "REFUTED") {
    // 재확인이 반대로 말했다. 어느 쪽도 확정하지 않는다.
    return { state: "CONFLICT", reasonCode: "COVE_REFUTED" };
  }
  return { state: "UNKNOWN", reasonCode: "COVE_INCONCLUSIVE" };
};

const statusOf = <T extends { claim_ref: string; status: string }>(
  results: { results: T[] } | null, claimRef: string,
): T["status"] | null => results?.results.find((entry) => entry.claim_ref === claimRef)?.status ?? null;

export const buildFinalClaims = (args: {
  claims: (ConfirmedClaim & { claimId: string })[];
  run: OrchestratedRun;
}): FinalClaim[] => {
  const { claims, run } = args;
  // 근거마다 어떤 관계로 인용됐는지는 Domain Agent 가 말한다.
  const relationOf = new Map<string, "SUPPORT" | "CONTRADICT" | "CONTEXT">();
  for (const finding of run.findings) {
    for (const ref of finding.evidence_refs) {
      if (!relationOf.has(ref)) relationOf.set(ref, finding.relation);
    }
  }

  return claims.map((claim) => {
    const judged = run.judgeOutput?.claim_results.find((entry) => entry.claim_ref === claim.claim_ref);
    const isMaterial = claim.materiality === "MATERIAL";
    const cove = isMaterial
      ? ((statusOf(run.cove as CoveOutput | null, claim.claim_ref) ?? "INCONCLUSIVE") as FinalClaim["cove_status"])
      : "NOT_REQUIRED";
    const redTeam = isMaterial
      ? ((statusOf(run.redTeam as RedTeamOutput | null, claim.claim_ref) ?? "NONE_FOUND") as FinalClaim["red_team_status"])
      : "NOT_REQUIRED";
    const base: ClaimState = (judged?.state as ClaimState | undefined) ?? "UNKNOWN";
    const decided = applyIndependentChecks(base, isMaterial, cove, redTeam);

    const refs = judged?.evidence_refs ?? [];
    const evidences = refs
      .map((ref) => ({ evidence_id: run.evidenceIds.get(ref), relation: relationOf.get(ref) ?? "CONTEXT" }))
      .filter((entry): entry is { evidence_id: string; relation: "SUPPORT" | "CONTRADICT" | "CONTEXT" } =>
        typeof entry.evidence_id === "string");

    return {
      claim_id: claim.claimId,
      status: decided.state,
      reason_code: decided.reasonCode,
      cove_status: cove,
      red_team_status: redTeam,
      decision_summary_masked: judged?.rationale_masked ?? "확인하지 못했습니다.",
      evidences,
    };
  });
};

/** 축은 세 개를 모두 낸다. 확인하지 않은 축도 확인하지 않았다고 적는다. */
export const buildAxisResults = (finals: FinalClaim[], hasProfile: boolean) => {
  const any = (states: ClaimState[]) => finals.some((entry) => states.includes(entry.status));
  const authenticity = any(["CONTRADICTED"]) ? "CONTRADICTED"
    : any(["CONFLICT"]) ? "CONFLICTING"
      : finals.length > 0 && finals.every((entry) => entry.status === "VERIFIED") ? "CONFIRMED" : "UNCERTAIN";
  return [
    {
      axis: "AUTHENTICITY", result_code: authenticity,
      summary_masked: "상품과 기관과 접근 경로가 공식 자료와 맞는지 본 결과입니다.",
      limitation_codes: [],
    },
    {
      axis: "TRANSACTION_SALES_RISK", result_code: authenticity === "CONFIRMED" ? "UNCERTAIN" : authenticity,
      summary_masked: "설명과 권유 방식은 가입 뒤에 확인할 수 있는 항목이 많아 범위가 제한됩니다.",
      limitation_codes: ["PRE_TRANSACTION_SCOPE"],
    },
    {
      // AUTH-006·007: 프로필을 건너뛰면 적합성 축만 정보 부족으로 남긴다.
      axis: "SUITABILITY",
      result_code: hasProfile ? "UNCERTAIN" : "NEED_MORE_INFORMATION",
      summary_masked: hasProfile
        ? "적합성은 프로필과 상품 조건을 함께 봐야 하며 이번 실행에서는 확정하지 않았습니다."
        : "금융 프로필이 없어 적합성은 판단하지 않았습니다. 안전하다는 뜻이 아닙니다.",
      limitation_codes: hasProfile ? [] : ["PROFILE_SKIPPED"],
    },
  ];
};

export const finalizeRun = async (args: {
  sql: Sql;
  runId: string;
  claims: (ConfirmedClaim & { claimId: string })[];
  run: OrchestratedRun;
  hasProfile: boolean;
}): Promise<{ ok: true; passportId: string } | { ok: false; reason: string }> => {
  const finals = buildFinalClaims({ claims: args.claims, run: args.run });
  const axes = buildAxisResults(finals, args.hasProfile);
  const partialReasons = args.run.agentResults
    .filter((entry) => entry.status !== "SUCCEEDED")
    .map((entry) => entry.reasonCode ?? "AGENT_PARTIAL");
  try {
    const rows = await args.sql`
      select private.finalize_verification_run(${args.runId}::uuid,
        ${JSON.stringify(finals)}::text::jsonb, ${JSON.stringify(axes)}::text::jsonb, null,
        ${partialReasons}::text[], 'p1') as id`;
    return { ok: true, passportId: rows[0].id as string };
  } catch (error) {
    // 저장에 실패하면 결과를 확정된 것처럼 보여 주지 않는다.
    const code = String((error as { code?: string })?.code ?? "FINALIZE_FAILED");
    return { ok: false, reason: code };
  }
};
