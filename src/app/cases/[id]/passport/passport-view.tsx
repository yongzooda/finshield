"use client";

import { readSessionToken, sessionIdentity } from "../../../session-client";

/**
 * Evidence Passport (S-012).
 *
 * 이 판단이 어떤 구성에서 나왔는지를 한 장으로 남긴다. 덮어쓰지 않고 판을 쌓는다.
 * 그래서 나중에 결과가 달라졌을 때 무엇이 달라졌는지 되짚을 수 있다.
 *
 * P0 에서는 화면으로만 제공한다. 인쇄와 내려받기는 다음 단계다 (PASS-005).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../../../fs-shell";
import { AxisLimitations, ClaimBadges, ClaimReviewDetails, ResultScopeNote, ReviewNotice } from "../../../result-explanation";
import { FsLoginCard, useFsToken } from "../../../fs-session";
import { OfficialActions, type StoredGuide } from "../../../official-actions";
import { EvidenceCitation, type EvidenceCitationData } from "../../../evidence-citation";
import { fetchCase } from "../../case-api";
import {
  AXIS_LABEL, axisResultOf, overallResultOf, runStatusLabel,
} from "../../../fs-labels";

type Passport = {
  guide?: StoredGuide | null;
  id: string; verification_run_id: string; passport_version_no: number;
  overall_result: string; coverage_satisfied: boolean;
  passport_schema_version: string; manifest: Record<string, unknown>;
  payload_hash: string; created_at: string;
};
type Detail = {
  case: { title_masked: string; scenario: string };
  runs: { id: string; run_no: number; status: string; partial_reason_codes: string[] | null;
    finished_at: string | null }[];
  final_claims: { id: string; verification_run_id: string; status: string; reason_code: string;
    cove_status: string; red_team_status: string; is_material: boolean; statement_masked: string; decision_summary_masked: string }[];
  axes: { verification_run_id: string; axis: string; result_code: string; summary_masked: string; limitation_codes?: string[] | null; policy_evaluation?: { policy_version: string; checks: { rule_code: string; reason_masked: string; outcome: string; evidence_id?: string }[] } | null }[];
  claim_evidences: { final_claim_version_id: string; evidence_id: string; relation: string; is_independent: boolean }[];
  evidences: (EvidenceCitationData & { independence_key: string; citable: boolean })[];
  passports: Passport[];
};

export function PassportView({ caseId, requestedPassport = null }: { caseId: string; requestedPassport?: string | null }) {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(requestedPassport);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);

  useEffect(() => {
    const token = readSessionToken();
    if (!ready || !token || sessionIdentity(token) !== sessionKey) return;
    let alive = true;
    void (async () => {
      const result = await fetchCase<Detail>(caseId, token);
      if (!alive || sessionIdentity(readSessionToken()) !== sessionKey) return;
      if (result.ok) { setDetail(result.data); setLoadedSession(sessionKey); setNotice(null); return; }
      if (result.status === 401) setToken(null);
      setNotice(result.error);
    })();
    return () => { alive = false; };
  }, [ready, sessionKey, caseId, setToken]);

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} />;
  if (!detail || loadedSession !== sessionKey) return <FsCard className="mt-8"><p className="fs-body">{notice ?? "불러오는 중입니다."}</p></FsCard>;

  const passport = selectedVersion ? detail.passports.find((row) => row.id === selectedVersion) : detail.passports[0];
  if (selectedVersion && !passport) return <FsCard className="mt-8"><p className="fs-body">요청한 검증 기록을 찾을 수 없습니다.</p><Link href={`/cases/${caseId}/passport`} className="fs-btn fs-btn--quiet mt-4">검증 기록 목록으로</Link></FsCard>;
  if (!passport) {
    return (
      <FsCard className="mt-8">
        <h2 className="fs-h2">아직 검증 근거 기록이 없습니다</h2>
        <p className="fs-body mt-2">검증이 확정되면 이 자리에 남습니다.</p>
        <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet mt-4">기록으로 돌아가기</Link>

      </FsCard>
    );
  }

  const run = detail.runs.find((row) => row.id === passport.verification_run_id);
  const finals = detail.final_claims.filter((row) => row.verification_run_id === passport.verification_run_id);
  const axes = detail.axes.filter((row) => row.verification_run_id === passport.verification_run_id);
  const usedEvidenceIds = new Set(
    detail.claim_evidences.filter((link) => finals.some((f) => f.id === link.final_claim_version_id))
      .map((link) => link.evidence_id));
  const used = detail.evidences.filter((row) => usedEvidenceIds.has(row.id));
  const independentKeys = new Set(used.map((row) => row.independence_key));
  const overall = overallResultOf(passport.overall_result);

  return (
    <>
      <header>
        <p className="fs-eyebrow">검증 근거 기록 · Evidence Passport</p>
        <h1 className="fs-h1 mt-2">{detail.case.title_masked}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <FsChip tone={overall.tone}>{overall.label}</FsChip>
          <FsChip tone={passport.coverage_satisfied ? "verified" : "caution"}>
            {passport.coverage_satisfied ? "범위 충족" : "범위 미충족"}
          </FsChip>
          <span className="fs-meta">
            버전 {passport.passport_version_no} · {new Date(passport.created_at).toLocaleString("ko-KR")}
          </span>
        </div>
        <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet mt-4">기록으로 돌아가기</Link>
        {detail.passports.length > 1 ? (
          <div className="mt-5 max-w-sm">
            <label htmlFor="passport-version" className="fs-label">기록 버전</label>
            <select id="passport-version" className="fs-field" value={passport.id}
              onChange={(event) => setSelectedVersion(event.target.value)}>
              {detail.passports.map((row) => <option key={row.id} value={row.id}>
                버전 {row.passport_version_no} · {new Date(row.created_at).toLocaleDateString("ko-KR")}
              </option>)}
            </select>
          </div>
        ) : null}
      </header>

      <OfficialActions guide={passport.guide} title="지금 하실 일" />
      {run ? <ReviewNotice status={run.status} reasons={run.partial_reason_codes ?? []} /> : null}
      <FsCard className="mt-8">
        <h2 className="fs-h2">세 가지 확인 결과</h2>
        <ul className="mt-4 space-y-3">
          {axes.map((axis) => {
            const view = axisResultOf(axis.result_code, axis.axis);
            return (
              <li key={axis.axis} className="border-t border-[var(--fs-line)] pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{AXIS_LABEL[axis.axis] ?? axis.axis}</span>
                  <FsChip tone={view.tone}>{view.label}</FsChip>
                </div>
                <p className="fs-meta mt-1">{axis.summary_masked}</p>
                <AxisLimitations codes={axis.limitation_codes} />
                {axis.policy_evaluation ? <details className="mt-2">
                  <summary className="cursor-pointer text-sm underline">프로필 비교 이유와 확인하지 못한 조건</summary>
                  <p className="fs-meta mt-2">검증을 시작할 때 저장한 프로필을 사용했습니다. 현재 프로필을 수정해도 이 결과는 바뀌지 않습니다.</p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {axis.policy_evaluation.checks.map((check, index) => <li key={`${check.rule_code}:${index}`}>{check.reason_masked}</li>)}
                  </ul>
                  <p className="fs-meta mt-2">적용 규칙: {axis.policy_evaluation.policy_version}</p>
                </details> : null}
              </li>
            );
          })}
        </ul>
      </FsCard>

      <FsCard>
        <h2 className="fs-h2">항목별 확인 결과</h2>
        <ResultScopeNote />
        <ul className="mt-4 space-y-4">
          {finals.map((row) => {
            const links = detail.claim_evidences.filter((link) => link.final_claim_version_id === row.id);
            return (
              <li key={row.id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-xl font-semibold leading-relaxed">{row.statement_masked}</p>
                  <ClaimBadges status={row.status} reason={row.reason_code} />
                </div>
                <p className="fs-body mt-2">{row.decision_summary_masked}</p>
                <ClaimReviewDetails reason={row.reason_code} cove={row.cove_status} redTeam={row.red_team_status} />
                <p className="fs-meta mt-2">근거 {links.length}건 · 독립성 확인 근거 {links.filter(link => link.is_independent).length}건</p>
                <ul className="mt-3 space-y-2">{links.map(link => {
                  const evidence = detail.evidences.find(item => item.id === link.evidence_id);
                  return evidence ? <li key={evidence.id}><EvidenceCitation evidence={evidence} /></li> : null;
                })}</ul>
              </li>
            );
          })}
        </ul>
      </FsCard>

      <FsCard>
        <details>
        <summary className="font-semibold">검증 기록 상세 정보</summary>
        <dl className="fs-meta mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt>기록 버전</dt><dd>{passport.passport_version_no} · schema {passport.passport_schema_version}</dd>
          <dt>실행 번호</dt><dd>{run?.run_no ?? "-"} · {run ? runStatusLabel(run.status) : "-"}</dd>
          <dt>쓴 근거</dt><dd>{used.length}건 · 독립 출처 {independentKeys.size}곳</dd>
          <dt>인용 가능 근거</dt><dd>{used.filter((row) => row.citable).length}건</dd>
          <dt>참고용 근거</dt><dd>{used.filter((row) => row.reference_only).length}건</dd>
          <dt>최근 수집한 근거</dt><dd>{used.filter((row) => row.freshness_at_use === "FRESH").length}건</dd>
          <dt>본문 해시</dt><dd className="break-all">{passport.payload_hash}</dd>
        </dl>
        <p className="fs-meta mt-4">
          같은 원문에서 나온 근거는 하나로 셉니다. 출처 수만으로 판단의 정확성을 보장하지 않습니다.
        </p>
        </details>
      </FsCard>
    </>
  );
}
