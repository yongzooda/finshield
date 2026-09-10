"use client";

/**
 * 공개 Demo 의 완료 결과 (S-001).
 *
 * 회원 결과 화면과 같은 순서와 같은 판정 규칙으로 보여 준다. 먼저 지금 할 일과
 * 공식 확인 창구, 그다음 세 가지 확인 결과, 마지막에 항목별 근거다 (RES-005).
 * 체험 화면만 다른 결론을 말하면 심사·사용자가 어느 쪽을 믿어야 할지 모른다.
 */

import { useState } from "react";
import Link from "next/link";
import { FsCard, FsChip, claimViewOf } from "../fs-shell";
import {
  AXIS_LABEL, axisResultOf, DIRECTNESS_LABEL, FRESHNESS_LABEL, RELATION_LABEL, nextAction, overallResultOf,
} from "../fs-labels";
import {
  AxisLimitations, ClaimBadges, ClaimReviewDetails, ResultScopeNote, ReviewNotice,
} from "../result-explanation";

type Evidence = {
  ref: string; title: string; source: string; grade: string; official_id: string | null;
  url: string | null; published_at: string | null; fetched_at: string | null;
  content_hash: string | null; freshness: string; directness: string;
  reference_only: boolean; excerpt: string;
};
type Axis = { axis: string; result_code: string; summary_masked: string; limitation_codes: string[] };

export type DemoResult = {
  seed_version: string; partial: boolean; is_precomputed: boolean;
  // RECENT_LIVE 는 지금 실행한 것이 아니라 가장 최근에 성공한 실제 실행 기록이다.
  mode?: string; computed_at?: string;
  // demo-result-v1 에는 아래 넷이 없다. 없으면 그 칸을 그리지 않는다.
  overall_result?: string;
  axes?: Axis[];
  guide?: { channels: { action_no: number; display_value: string }[] } | null;
  agents?: { agent_code: string; status: string; reason_code?: string | null }[];
  judge_reason_code?: string | null;
  claims: {
    claim_ref: string; statement_masked: string; state: string; reason_code?: string | null;
    cove_status?: string | null; red_team_status?: string | null;
    rationale_masked: string; evidence_refs: string[]; relations?: Record<string, string>;
  }[];
  evidence: Evidence[];
};

// 반대가 가장 강하고, 뒷받침, 맥락 순이다. 모르는 관계는 맨 뒤다.
const RELATION_RANK: Record<string, number> = { CONTRADICT: 0, SUPPORT: 1, CONTEXT: 2 };
const relationRank = (relation?: string) => RELATION_RANK[relation ?? ""] ?? 3;

const kstTime = (iso: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(iso));

/**
 * 여러 단계가 같은 공식 자료를 따로 조회하면 같은 원문이 인용 이름만 달리해 여러 번 온다.
 * 화면에는 원문 하나로 묶어 보여 주고 가장 강한 관계를 남긴다. 저장된 인용은 그대로다.
 */
export const groupEvidence = (claim: DemoResult["claims"][number], evidence: Evidence[]) => {
  const grouped = new Map<string, { item: Evidence; relation: string | undefined }>();
  for (const item of evidence.filter((entry) => claim.evidence_refs.includes(entry.ref))) {
    const key = `${item.official_id ?? item.ref}|${item.content_hash ?? item.ref}|${item.title}`;
    const relation = claim.relations?.[item.ref];
    const previous = grouped.get(key);
    if (!previous) grouped.set(key, { item, relation });
    else if (relationRank(relation) < relationRank(previous.relation)) previous.relation = relation;
  }
  return [...grouped.values()];
};

/** 회원 결과 화면과 같은 규칙으로 검토가 제한된 까닭을 모은다 (RES-008). */
const reviewReasonsOf = (result: DemoResult): string[] => [
  ...(result.agents ?? []).flatMap((agent) => agent.status === "SUCCEEDED" ? []
    : [agent.reason_code ?? "AGENT_PARTIAL", `AGENT_${agent.agent_code}_PARTIAL`]),
  ...(result.judge_reason_code ? [result.judge_reason_code] : []),
];

export function DemoResultView({ result }: { result: DemoResult }) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const evidenceOf = (claim: DemoResult["claims"][number]) => groupEvidence(claim, result.evidence);
  const axes = result.axes ?? [];
  // 회원 결과와 같은 함수로 지금 할 일을 정한다. 두 화면이 다른 말을 하지 않는다.
  const action = result.claims.length > 0
    ? nextAction(result.claims.map((claim) => claim.state), axes.some((axis) => axis.result_code === "HIGH_RISK_ACTION"))
    : null;
  const overall = result.overall_result ? overallResultOf(result.overall_result) : null;
  const channels = result.guide?.channels ?? [];
  const replayed = result.mode === "RECENT_LIVE" && result.computed_at ? kstTime(result.computed_at) : null;

  return (
    <>
      <FsCard>
        <div className="flex flex-wrap items-center gap-3">
          <FsChip tone={result.is_precomputed || replayed ? "caution" : "verified"}>
            {result.is_precomputed ? "사전 계산 결과" : replayed ? "지난 실제 실행 결과" : "실제 실행 결과"}
          </FsChip>
          <span className="fs-meta">체험 자료 {result.seed_version}</span>
          {result.partial ? <FsChip tone="caution">일부만 확인</FsChip> : null}
        </div>
        {action ? (
          <>
            <p className="fs-eyebrow mt-4">지금 하실 일</p>
            <h2 className="fs-h2 mt-2">{action.title}</h2>
            <p className="fs-body mt-2">{action.detail}</p>
            {channels.map((channel) => (
              <p key={channel.display_value} className="fs-body mt-3 font-semibold">공식 확인 창구: {channel.display_value}</p>
            ))}
          </>
        ) : null}
        {overall ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="fs-meta">종합 결과</span>
            <FsChip tone={overall.tone}>{overall.label}</FsChip>
          </div>
        ) : null}
        <p className="fs-meta mt-3">
          {result.is_precomputed
            ? "미리 계산된 결과입니다. 현재 실행 결과와 구분해 확인해 주세요."
            : replayed
              ? `${replayed} 에 실제로 실행한 결과입니다. 지금 다시 실행한 결과가 아니며, 그때 조회한 공식 자료를 기준으로 합니다.`
              : "이번에 조회한 공식 자료를 바탕으로 회원 검증과 같은 규칙으로 정리한 결과입니다."}
        </p>
      </FsCard>

      {result.partial ? <ReviewNotice status="PARTIAL" reasons={reviewReasonsOf(result)} /> : null}

      {axes.length > 0 ? (
        <FsCard>
          <h2 className="fs-h2">세 가지 확인 결과</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {axes.map((axis) => (
              <section key={axis.axis}>
                <h3 className="font-bold">{AXIS_LABEL[axis.axis] ?? axis.axis}</h3>
                <FsChip tone={axisResultOf(axis.result_code, axis.axis).tone}>{axisResultOf(axis.result_code, axis.axis).label}</FsChip>
                <p className="fs-meta mt-2">{axis.summary_masked}</p>
                <AxisLimitations codes={axis.limitation_codes} />
              </section>
            ))}
          </div>
        </FsCard>
      ) : null}

      <FsCard>
        <h2 className="fs-h2">항목별 확인 결과</h2>
        <ResultScopeNote />
        <ul className="mt-5 space-y-5">
          {result.claims.map((claim) => {
            const view = claimViewOf(claim.state, claim.reason_code ?? undefined);
            const items = evidenceOf(claim);
            const isOpen = opened.has(claim.claim_ref);
            return (
              <li key={claim.claim_ref} className="border-t border-[var(--fs-line)] pt-5 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-xl leading-relaxed">{claim.statement_masked}</p>
                  <ClaimBadges status={claim.state} reason={claim.reason_code ?? undefined} />
                </div>
                <p className="fs-body mt-2">{claim.rationale_masked}</p>
                <p className="fs-meta mt-1">{view.help}</p>
                <ClaimReviewDetails reason={claim.reason_code ?? undefined}
                  cove={claim.cove_status ?? undefined} redTeam={claim.red_team_status ?? undefined} />
                {items.length > 0 ? (
                  <>
                    <button type="button" aria-expanded={isOpen}
                      className="fs-btn fs-btn--quiet mt-3 !px-3 !text-[0.9rem]"
                      onClick={() => setOpened((prev) => {
                        const next = new Set(prev);
                        if (next.has(claim.claim_ref)) next.delete(claim.claim_ref);
                        else next.add(claim.claim_ref);
                        return next;
                      })}>
                      {isOpen ? "근거 접기" : `근거 ${items.length}건 보기`}
                    </button>
                    {isOpen ? (
                      <ul className="mt-3 space-y-3">
                        {items.map(({ item, relation }) => {
                          return (
                            <li key={item.ref} className="rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <FsChip tone="neutral">{item.ref}</FsChip>
                                {relation ? (
                                  <FsChip tone={relation === "CONTRADICT" ? "contra" : "neutral"}>{RELATION_LABEL[relation] ?? relation}</FsChip>
                                ) : null}
                                <FsChip tone={item.grade === "A" ? "verified" : "neutral"}>권위 {item.grade}</FsChip>
                                <FsChip tone={item.freshness === "FRESH" ? "verified" : "caution"}>
                                  {FRESHNESS_LABEL[item.freshness] ?? item.freshness}
                                </FsChip>
                                {item.reference_only ? <FsChip tone="caution">참고용</FsChip> : null}
                              </div>
                              <p className="mt-2 font-bold">{item.title}</p>
                              <p className="fs-body mt-1">{item.excerpt}</p>
                              <dl className="fs-meta mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                <dt>출처 종류</dt>
                                <dd>{item.source} · {DIRECTNESS_LABEL[item.directness] ?? item.directness}</dd>
                                <dt>공식 식별자</dt><dd>{item.official_id ?? "없음"}</dd>
                                <dt>발행일</dt><dd>{item.published_at ?? "불명"}</dd>
                                <dt>조회 시각</dt><dd>{item.fetched_at ?? "불명"}</dd>
                                <dt>본문 해시</dt><dd className="break-all">{item.content_hash ?? "불명"}</dd>
                              </dl>
                              {item.url ? (
                                <a className="fs-meta mt-1 inline-block underline" href={item.url}
                                  target="_blank" rel="noreferrer noopener">원문 열기</a>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="fs-meta mt-2">인용한 근거가 없습니다. 그래서 확정하지 않았습니다.</p>
                )}
              </li>
            );
          })}
        </ul>
      </FsCard>

      <FsCard>
        <h2 className="fs-h2">여기서 남은 것</h2>
        <p className="fs-body mt-2">
          이 실행은 회원 기록과 분리된 체험 기록에만 남았습니다. 회원 기록도, 프로필도, 방문자 입력도 만들지 않았습니다.
          체험에는 준비된 가상 문자만 쓰므로 개인정보가 남지 않습니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/verify" className="fs-btn fs-btn--primary">내 건으로 확인하기</Link>
          <Link href="/trust" className="fs-btn fs-btn--quiet">무엇이 검증됐는지</Link>
        </div>
      </FsCard>
    </>
  );
}
