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
import { buildActionGuide } from "./action-guide";
import type { OrchestratedRun } from "./orchestrator";

type Sql = ReturnType<typeof postgres>;

const CONFIRMED_STATES: ClaimState[] = ["VERIFIED", "CONTRADICTED"];

export type FinalClaim = {
  claim_id: string;
  claim_type?: string;
  status: ClaimState;
  reason_code: string;
  cove_status: "CONFIRMED" | "CHALLENGED" | "UNRESOLVED" | "FAILED" | "NOT_REQUIRED";
  red_team_status: "COUNTER_EVIDENCE" | "SUPPORTED_INITIAL" | "UNRESOLVED" | "FAILED" | "NOT_REQUIRED";
  decision_summary_masked: string;
  evidences: { evidence_id: string; relation: "SUPPORT" | "CONTRADICT" | "CONTEXT"; is_independent?: boolean; policy_reason_code?: string }[];
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
  cove: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE" | "FAILED" | "NOT_REQUIRED",
  redTeam: "COUNTER_EVIDENCE" | "NONE_FOUND" | "FAILED" | "NOT_REQUIRED",
): { state: ClaimState; reasonCode: string } => {
  if (!CONFIRMED_STATES.includes(state)) return { state, reasonCode: "AS_JUDGED" };
  if (isMaterial && (cove === "FAILED" || redTeam === "FAILED")) {
    return { state: "WITHHELD", reasonCode: "INDEPENDENT_REVIEW_FAILED" };
  }
  if (state === "VERIFIED" && redTeam === "COUNTER_EVIDENCE") {
    // 반대 근거가 있으면 한쪽으로 정하지 않는다. 양쪽을 보존한다.
    return { state: "CONFLICT", reasonCode: "RED_TEAM_COUNTER_EVIDENCE" };
  }
  if (!isMaterial) return { state, reasonCode: "AS_JUDGED" };
  // CoVe는 초기 결론을 모르므로 원 Claim의 진위를 말한다.
  // Judge의 반증과 CoVe의 REFUTED가 일치하면 독립 재확인에 성공한 것이다.
  if ((state === "VERIFIED" && cove === "CONFIRMED") || (state === "CONTRADICTED" && cove === "REFUTED")) {
    return { state, reasonCode: "COVE_CONFIRMED" };
  }
  if (cove === "REFUTED" || cove === "CONFIRMED") return { state: "CONFLICT", reasonCode: "COVE_REFUTED" };
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
      const key = `${finding.claim_ref}:${ref}`;
      const previous = relationOf.get(key);
      relationOf.set(key, previous && previous !== finding.relation ? "CONTEXT" : finding.relation);
    }
  }

  return claims.map((claim) => {
    const judged = run.judgeOutput?.claim_results.find((entry) => entry.claim_ref === claim.claim_ref);
    const isMaterial = claim.materiality === "MATERIAL";
    const cove = isMaterial
      ? (statusOf(run.cove as CoveOutput | null, claim.claim_ref) ?? "FAILED")
      : "NOT_REQUIRED";
    const redTeam = isMaterial
      ? (statusOf(run.redTeam as RedTeamOutput | null, claim.claim_ref) ?? "FAILED")
      : "NOT_REQUIRED";
    const base: ClaimState = (judged?.state as ClaimState | undefined) ?? (run.judgeReasonCode ? "WITHHELD" : "UNKNOWN");
    const decided = applyIndependentChecks(base, isMaterial, cove, redTeam);

    const reviewRefs = [
      ...(run.cove?.results.filter(entry => entry.claim_ref === claim.claim_ref).flatMap(entry => entry.evidence_refs) ?? []),
      ...(run.redTeam?.results.filter(entry => entry.claim_ref === claim.claim_ref).flatMap(entry => entry.evidence_refs) ?? []),
    ];
    for (const ref of reviewRefs) {
      const coveResult = run.cove?.results.find(entry => entry.claim_ref === claim.claim_ref && entry.evidence_refs.includes(ref));
      const redResult = run.redTeam?.results.find(entry => entry.claim_ref === claim.claim_ref && entry.evidence_refs.includes(ref));
      relationOf.set(`${claim.claim_ref}:${ref}`, coveResult?.status === "CONFIRMED" ? "SUPPORT"
        : coveResult?.status === "REFUTED" || redResult?.status === "COUNTER_EVIDENCE" ? "CONTRADICT" : "CONTEXT");
    }
    const refs = [...new Set([...(judged?.evidence_refs ?? []), ...reviewRefs])];
    const seenSources = new Set<string>();
    const evidences = refs
      .map((ref) => ({ evidence_id: run.evidenceIds.get(ref), relation: relationOf.get(`${claim.claim_ref}:${ref}`) ?? "CONTEXT" }))
      .filter((entry): entry is { evidence_id: string; relation: "SUPPORT" | "CONTRADICT" | "CONTEXT" } =>
        typeof entry.evidence_id === "string")
      .map(entry => {
        const source = run.evidence.find(item => run.evidenceIds.get(item.evidence_ref) === entry.evidence_id);
        const eligible = entry.relation !== "CONTEXT" && source?.citable && !source.incomplete && !source.reference_only
          && source.freshness_at_use === "FRESH" && source.directness === "DIRECT";
        const independent = Boolean(eligible && source && !seenSources.has(source.independence_key));
        if (independent && source) seenSources.add(source.independence_key);
        return { ...entry, is_independent: independent,
          policy_reason_code: independent ? "FIRST_CANONICAL_SOURCE" : eligible ? "DUPLICATE_CANONICAL_SOURCE" : "CONTEXT_ONLY_SOURCE" };
      });

    return {
      claim_id: claim.claimId,
      claim_type: claim.claim_type,
      status: decided.state,
      reason_code: decided.reasonCode,
      cove_status: cove === "INCONCLUSIVE" ? "UNRESOLVED"
        : cove === "FAILED" || cove === "NOT_REQUIRED" ? cove
        : decided.reasonCode === "COVE_CONFIRMED" ? "CONFIRMED" : "CHALLENGED",
      // NONE_FOUND 는 초기 결론 지지가 아니라 이번 검색에서 반증을 못 찾았다는 뜻이다.
      red_team_status: redTeam === "NONE_FOUND" ? "UNRESOLVED" : redTeam,
      decision_summary_masked: judged?.rationale_masked ?? "확인하지 못했습니다.",
      evidences,
    };
  });
};

/** 축은 세 개를 모두 낸다. 확인하지 않은 축도 확인하지 않았다고 적는다. */
export const buildAxisResults = (finals: FinalClaim[], hasProfile: boolean) => {
  const aggregate = (items: FinalClaim[]) => items.some(item => item.status === "CONTRADICTED") ? "CONTRADICTED"
    : items.some(item => item.status === "CONFLICT") ? "CONFLICTING"
      : items.length > 0 && items.every(item => item.status === "VERIFIED") ? "CONFIRMED" : "UNCERTAIN";
  const authenticity = aggregate(finals.filter(item => !item.claim_type || ["PRODUCT_TERM", "INSTITUTION", "CHANNEL"].includes(item.claim_type)));
  const risks = finals.filter(item => ["CONDUCT", "CHANNEL"].includes(item.claim_type ?? ""));
  // 권유 항목의 사실 확인이 거래 안전을 입증하지 않는다.
  const risk = aggregate(risks);
  return [
    {
      axis: "AUTHENTICITY", result_code: authenticity,
      summary_masked: "상품과 기관과 접근 경로가 공식 자료와 맞는지 본 결과입니다.",
      limitation_codes: [],
    },
    {
      axis: "TRANSACTION_SALES_RISK", result_code: risk === "CONFIRMED" ? "UNCERTAIN" : risk,
      summary_masked: risks.length ? "접근 경로와 권유 방식에 해당하는 항목만 확인했습니다. 선입금·앱 설치 요구는 공식 창구에서 먼저 확인하세요." : "권유 방식·접근 경로에 대한 확인 항목이 없어 거래 위험을 확정하지 않았습니다.",
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
}): Promise<{ ok: true; passportId: string; guide: Awaited<ReturnType<typeof buildActionGuide>>["display"] } | { ok: false; reason: string }> => {
  const finals = buildFinalClaims({ claims: args.claims, run: args.run });
  const axes = buildAxisResults(finals, args.hasProfile);
  const partialReasons = args.run.agentResults
    .filter((entry) => entry.status !== "SUCCEEDED")
    .map((entry) => entry.reasonCode ?? "AGENT_PARTIAL");
  if (args.run.judgeReasonCode) partialReasons.push(args.run.judgeReasonCode);
  try {
    const guide = await buildActionGuide(args.sql);
    const rows = await args.sql`
      select private.finalize_verification_run(${args.runId}::uuid,
        ${JSON.stringify(finals)}::text::jsonb, ${JSON.stringify(axes)}::text::jsonb, ${JSON.stringify(guide.stored)}::text::jsonb,
        ${partialReasons}::text[], 'p1') as id`;
    return { ok: true, passportId: rows[0].id as string, guide: guide.display };
  } catch (error) {
    // 저장에 실패하면 결과를 확정된 것처럼 보여 주지 않는다.
    const code = String((error as { code?: string })?.code ?? "FINALIZE_FAILED");
    return { ok: false, reason: code };
  }
};
