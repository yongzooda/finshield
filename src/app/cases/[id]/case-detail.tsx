"use client";

import { readSessionToken, sessionIdentity } from "../../session-client";

/**
 * Case 상세 (S-011·S-013).
 *
 * 판단마다 근거를 열 수 있다 (EV-001). 근거에는 되짚을 수 있는 값을 함께 적는다 (EV-002).
 * 상태 축을 하나로 합치지 않는다. Case 수명 주기와 실행 상태와 Claim 상태는 다른 축이다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { CLAIM_STATE_VIEW, FsCard, FsChip } from "../../fs-shell";
import { FsLoginCard, useFsToken } from "../../fs-session";
import { fetchCase } from "../case-api";
import {
  ACTION_LABEL, AFTERCARE_RESULT, AFTERCARE_STATUS, AXIS_LABEL, FRESHNESS_LABEL, JOURNEY_STAGE,
  RELATION_LABEL, axisResultOf, actorLabel, coveLabel, eventLabel, limitationLabel, nextAction,
  partialLabel, reasonLabel, runStatusLabel,
} from "../../fs-labels";

type Detail = {
  case: { id: string; scenario: string; lifecycle: string; title_masked: string; created_at: string;
    journey_stage: string; enrollment_confirmed_at: string | null; aftercare_status: string };
  claims: { id: string; claim_type: string }[];
  runs: { id: string; run_no: number; status: string; overall_result: string | null;
    coverage_satisfied: boolean | null; partial_reason_codes: string[] | null; finished_at: string | null }[];
  final_claims: { id: string; verification_run_id: string; claim_id: string; status: string;
    reason_code: string; cove_status: string; red_team_status: string; is_material: boolean;
    decision_summary_masked: string }[];
  axes: { verification_run_id: string; axis: string; result_code: string;
    summary_masked: string; limitation_codes: string[] | null }[];
  claim_evidences: { final_claim_version_id: string; evidence_id: string; relation: string;
    is_independent: boolean; policy_reason_code: string | null }[];
  evidences: { id: string; source_locator: Record<string, unknown>; excerpt_masked: string | null;
    directness: string; citable: boolean; reference_only: boolean; incomplete: boolean;
    freshness_at_use: string; independence_key: string; selection_reason_code: string;
    content_hash: string; created_at: string }[];
  passports: { id: string; verification_run_id: string; passport_version_no: number;
    overall_result: string; created_at: string }[];
  events: { event_no: number; event_type: string; actor_type: string; created_at: string }[];
  assessments: { id: string; assessment_no: number; status: string; result: string | null;
    summary_masked: string | null; finished_at: string | null }[];
  checklists: { id: string; precase_assessment_id: string; action_code: string; status: string;
    required_material_codes: string[] | null }[];
};

export function CaseDetail({ caseId }: { caseId: string }) {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  // 로그인이 끝나면 token 이 바뀌고, 그때 다시 읽는다. 화면을 떠난 뒤 도착한
  // 응답은 버린다.
  useEffect(() => {
    const token = readSessionToken();
    if (!ready || !token || sessionIdentity(token) !== sessionKey) return;
    let alive = true;
    void (async () => {
      const result = await fetchCase<Detail>(caseId, token);
      if (!alive) return;
      if (result.ok) { setDetail(result.data); setNotice(null); return; }
      if (result.status === 401) setToken(null);
      setNotice(result.error);
    })();
    return () => { alive = false; };
  }, [ready, sessionKey, caseId, setToken]);

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} />;
  if (!detail) {
    return <FsCard className="mt-8"><p className="fs-body">{notice ?? "불러오는 중입니다."}</p></FsCard>;
  }

  const latest = detail.runs[0];
  const finals = detail.final_claims.filter((row) => row.verification_run_id === latest?.id);
  const axes = detail.axes.filter((row) => row.verification_run_id === latest?.id);
  const passport = detail.passports.find((row) => row.verification_run_id === latest?.id);
  const partialReasons = latest?.partial_reason_codes ?? [];
  const assessments = detail.assessments ?? [];
  const action = finals.length > 0 ? nextAction(finals.map((row) => row.status)) : null;
  const evidenceOf = (finalId: string) => detail.claim_evidences
    .filter((link) => link.final_claim_version_id === finalId)
    .map((link) => ({ link, evidence: detail.evidences.find((row) => row.id === link.evidence_id) }))
    .filter((entry) => entry.evidence !== undefined);

  return (
    <>
      <header>
        <p className="fs-eyebrow">검증 기록</p>
        <h1 className="fs-h1 mt-2">{detail.case.title_masked}</h1>
        <p className="fs-meta mt-2">{new Date(detail.case.created_at).toLocaleString("ko-KR")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/cases" className="fs-btn fs-btn--quiet">목록으로</Link>
          {passport ? (
            <Link href={`/cases/${caseId}/passport`} className="fs-btn fs-btn--primary">검증 근거 기록</Link>
          ) : null}
          {passport ? (
            <Link href={`/cases/${caseId}/revalidate`} className="fs-btn fs-btn--quiet">다시 확인하기</Link>
          ) : null}
        </div>
      </header>

      {/* RES-008: 온전히 끝나지 않았으면 맨 위에 알린다. */}
      {latest && (!["COMPLETED", "SUCCEEDED"].includes(latest.status) || partialReasons.length > 0) ? (
        <FsCard className="mt-8">
          <FsChip tone="caution">{runStatusLabel(latest.status)}</FsChip>
          <p className="fs-body mt-2">
            {partialReasons.length > 0
              ? `끝까지 확인하지 못한 단계가 있습니다. ${partialReasons.map(partialLabel).join(" · ")}`
              : "이번 확인은 온전히 끝나지 않았습니다."}
          </p>
        </FsCard>
      ) : null}

      {/* RES-005: 결론보다 행동을 먼저 놓는다. */}
      {action ? (
        <FsCard className="mt-8">
          <p className="fs-eyebrow">지금 하실 일</p>
          <h2 className="fs-h2 mt-2">{action.title}</h2>
          <p className="fs-body mt-2">{action.detail}</p>
        </FsCard>
      ) : null}

      {latest ? (
        <FsCard>
          <h2 className="fs-h2">세 가지 확인 결과</h2>
          <p className="fs-body mt-2">진위성, 거래 위험, 개인 적합성의 확인 결과입니다.</p>
          <ul className="mt-4 space-y-3">
            {axes.length === 0 ? <li className="fs-body">아직 확정된 축별 결과가 없습니다.</li> : null}
            {axes.map((axis) => {
              const view = axisResultOf(axis.result_code);
              return (
                <li key={axis.axis} className="border-t border-[var(--fs-line)] pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">{AXIS_LABEL[axis.axis] ?? axis.axis}</span>
                    <FsChip tone={view.tone}>{view.label}</FsChip>
                  </div>
                  <p className="fs-meta mt-1">{axis.summary_masked}</p>
                  {(axis.limitation_codes ?? []).length > 0 ? (
                    <p className="fs-meta mt-1">
                      확인하지 못한 범위: {(axis.limitation_codes ?? []).map(limitationLabel).join(" · ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </FsCard>
      ) : null}

      <FsCard>
        <h2 className="fs-h2">항목별 결과와 근거</h2>
        {finals.length === 0 ? (
          <p className="fs-body mt-2">아직 확정된 결과가 없습니다.</p>
        ) : (
          <ul className="mt-4 space-y-5">
            {finals.map((row) => {
              const view = CLAIM_STATE_VIEW[row.status] ?? { label: row.status, tone: "neutral" as const, help: "" };
              const items = evidenceOf(row.id);
              const isOpen = opened.has(row.id);
              return (
                <li key={row.id} className="border-t border-[var(--fs-line)] pt-5 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-xl leading-relaxed">{row.decision_summary_masked}</p>
                    <FsChip tone={view.tone}>{view.label}</FsChip>
                  </div>
                  <p className="fs-meta mt-1">
                    {row.is_material ? "거래에 영향이 큰 항목" : "참고 항목"} · 이렇게 정한 이유: {reasonLabel(row.reason_code)}
                    {row.cove_status !== "NOT_REQUIRED" ? ` · 독립 재확인 ${coveLabel(row.cove_status)}` : ""}
                    {row.red_team_status === "COUNTER_EVIDENCE" ? " · 반대 근거 있음" : ""}
                  </p>
                  {items.length > 0 ? (
                    <>
                      <button type="button" aria-expanded={isOpen}
                        className="fs-btn fs-btn--quiet mt-3 !px-3 !text-[0.9rem]"
                        onClick={() => setOpened((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                          return next;
                        })}>
                        {isOpen ? "근거 접기" : `근거 ${items.length}건 보기`}
                      </button>
                      {isOpen ? (
                        <ul className="mt-3 space-y-3">
                          {items.map(({ link, evidence }) => (
                            <li key={link.evidence_id} className="rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <FsChip tone={link.relation === "CONTRADICT" ? "contra" : "neutral"}>
                                  {RELATION_LABEL[link.relation] ?? link.relation}
                                </FsChip>
                                <FsChip tone={link.is_independent ? "verified" : "neutral"}>
                                  {link.is_independent ? "독립 근거" : "같은 출처"}
                                </FsChip>
                                <FsChip tone={evidence!.freshness_at_use === "FRESH" ? "verified" : "caution"}>
                                  {FRESHNESS_LABEL[evidence!.freshness_at_use] ?? evidence!.freshness_at_use}
                                </FsChip>
                                {evidence!.reference_only ? <FsChip tone="caution">참고용</FsChip> : null}
                              </div>
                              <p className="fs-body mt-2">{evidence!.excerpt_masked ?? "본문 없음"}</p>
                              <details className="fs-details"><summary>출처·조회 정보</summary>
                              <dl className="fs-meta mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                                <dt>위치</dt><dd className="break-all">{JSON.stringify(evidence!.source_locator)}</dd>
                                <dt>인용 가능</dt><dd>{evidence!.citable ? "예" : "아니오"}</dd>
                                <dt>조회 시각</dt><dd>{new Date(evidence!.created_at).toLocaleString("ko-KR")}</dd>
                                <dt>본문 해시</dt><dd className="break-all">{evidence!.content_hash}</dd>
                              </dl>
                              </details>
                            </li>
                          ))}
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
        )}
      </FsCard>

      <FsCard>
        <h2 className="fs-h2">가입 후 보호</h2>
        <p className="fs-body mt-2">
          가입 사실을 등록하면 이 기록에서 설명과 계약 조건을 이어서 점검할 수 있습니다.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <FsChip tone={detail.case.journey_stage === "PRE_TRANSACTION" ? "neutral" : "caution"}>
            {JOURNEY_STAGE[detail.case.journey_stage] ?? detail.case.journey_stage}
          </FsChip>
          <FsChip tone={detail.case.aftercare_status === "ACTION_REQUIRED" ? "contra" : "neutral"}>
            {AFTERCARE_STATUS[detail.case.aftercare_status] ?? detail.case.aftercare_status}
          </FsChip>
          {detail.case.enrollment_confirmed_at ? (
            <span className="fs-meta">
              가입 확인 {new Date(detail.case.enrollment_confirmed_at).toLocaleString("ko-KR")}
            </span>
          ) : null}
        </div>

        {assessments.length > 0 ? (
          <ul className="mt-5 space-y-4">
            {assessments.map((row) => {
              const actions = (detail.checklists ?? []).filter((item) => item.precase_assessment_id === row.id);
              return (
                <li key={row.id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">{row.assessment_no}번째 점검</span>
                    {row.result ? (
                      <FsChip tone={AFTERCARE_RESULT[row.result]?.tone ?? "neutral"}>
                        {AFTERCARE_RESULT[row.result]?.label ?? row.result}
                      </FsChip>
                    ) : null}
                  </div>
                  {row.summary_masked ? <p className="fs-body mt-2">{row.summary_masked}</p> : null}
                  {actions.length > 0 ? (
                    <ul className="fs-meta mt-2 list-disc space-y-1 pl-5">
                      {actions.map((item) => (
                        <li key={item.id}>{ACTION_LABEL[item.action_code] ?? item.action_code}</li>
                      ))}
                    </ul>
                  ) : null}
                  {row.finished_at ? (
                    <p className="fs-meta mt-2">{new Date(row.finished_at).toLocaleString("ko-KR")}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/cases/${caseId}/journey`} className="fs-btn fs-btn--quiet">
            {detail.case.enrollment_confirmed_at ? "가입 내용 고치기" : "가입·피해 사실 등록"}
          </Link>
          {detail.case.enrollment_confirmed_at ? (
            <Link href={`/cases/${caseId}/aftercare`} className="fs-btn fs-btn--primary">
              {assessments.length > 0 ? "다시 점검하기" : "가입 후 점검 시작"}
            </Link>
          ) : null}
        </div>
      </FsCard>

      <FsCard>
        <details><summary className="font-semibold">진행 기록</summary>
        <ul className="fs-steps mt-4">
          {detail.events.map((event) => (
            <li key={event.event_no} data-state="done">
              <span className="font-bold">{eventLabel(event.event_type)}</span>
              <span className="fs-meta ml-2">
                {actorLabel(event.actor_type)} · {new Date(event.created_at).toLocaleString("ko-KR")}
              </span>
            </li>
          ))}
        </ul>
        </details>
      </FsCard>
    </>
  );
}
