"use client";

import { sessionFetch, readSessionToken, sessionIdentity } from "../../../session-client";

/**
 * 가입 후 점검 (S-016).
 *
 * 다른 사이트로 옮겨 가지 않는다. 같은 Case 안에서 묻고 같은 기록에 남긴다
 * (규칙 6).
 *
 * 결과는 정해진 규칙이 정한다. 모델이 결론을 만들지 않는다. 왜 그렇게 됐는지를
 * 결과와 함께 적는다. 연락처와 신고 창구는 공식 Registry 에 있는 값만 붙인다
 * (RES-007).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip, type ChipTone } from "../../../fs-shell";
import { FsLoginCard, useFsToken } from "../../../fs-session";
import { fetchCase } from "../../case-api";
import type { ContractComparison, PriorClaim } from "@/lib/finshield/contract-comparison";
import { QUESTIONS } from "@/lib/finshield/aftercare";

type Action = {
  action_code: string; label: string; detail: string;
  required_material_codes: string[]; official_channel: string | null;
};
type Result = { assessment_no?: number; finished_at?: string; result: string; reasons: string[]; actions: Action[]; comparison?: ContractComparison[] };

const RESULT_VIEW: Record<string, { label: string; state: string; tone: ChipTone; lead: string }> = {
  NORMAL_MANAGEMENT: {
    label: "계약서와 권유 기록을 보관하세요", state: "계약 자료 보관", tone: "neutral",
    lead: "답변한 범위에서 정정이나 분쟁 준비가 필요한 항목은 나오지 않았습니다. 답하지 않은 항목은 점검 범위에 포함되지 않습니다.",
  },
  ADDITIONAL_EXPLANATION: {
    label: "설명을 더 받으세요", state: "추가 설명 필요", tone: "caution",
    lead: "이해되지 않은 부분이 남아 있습니다. 그 부분만 다시 설명받으시면 됩니다.",
  },
  CORRECTION_OR_INQUIRY: {
    label: "공식 창구로 확인하세요", state: "정정·문의 필요", tone: "caution",
    lead: "설명과 계약 사이에 확인할 것이 남아 있습니다. 권유한 사람이 아니라 공식 창구로 확인하세요.",
  },
  DISPUTE_PREPARATION: {
    label: "자료를 모으고 공식 창구로 알리세요", state: "분쟁 준비", tone: "contra",
    lead: "계약이 설명과 다르다고 답하셨습니다. 지금부터는 자료를 모으는 것이 먼저입니다.",
  },
};

const MATERIAL_LABEL: Record<string, string> = {
  CONTRACT: "계약서", SALES_RECORD: "권유 문자·통화 기록",
};

export function AftercareFlow({ caseId }: { caseId: string }) {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [prior, setPrior] = useState<PriorClaim[]>([]);
  const [basePassport, setBasePassport] = useState<string | null>(null);
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const token = readSessionToken();
    if (!ready || !token || sessionIdentity(token) !== sessionKey) return;
    let alive = true;
    void (async () => {
      try {
        const [response, savedResponse] = await Promise.all([
          fetchCase<{ passports: { id: string; verification_run_id: string }[];
            final_claims: (PriorClaim & { verification_run_id: string })[] }>(caseId, token),
          sessionFetch(`/api/finshield/cases/${caseId}/aftercare`, token, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const saved = await savedResponse.json();
        if (!alive) return;
        if (!response.ok) { setNotice(response.error); return; }
        if (!savedResponse.ok) { setNotice(saved.error ?? "이전 점검 결과를 읽지 못했습니다"); return; }
        const assessment = saved.assessment;
        const passport = assessment
          ? response.data.passports.find(row => row.id === assessment.base_passport_id)
          : response.data.passports[0];
        setBasePassport(passport?.id ?? null);
        setPrior(response.data.final_claims.filter(claim => claim.verification_run_id === passport?.verification_run_id));
        if (assessment) {
          setAnswers(assessment.answers);
          setTerms(Object.fromEntries(assessment.comparison.map((row: ContractComparison) => [row.claim_id, row.contract])));
          setResult(assessment);
        } else { setResult(null); setAnswers({}); setTerms({}); }
      } catch { if (alive) setNotice("이전 기록을 읽지 못했습니다. 다시 열어 주세요."); }
      finally { if (alive) setLoadedSession(sessionKey); }
    })();
    return () => { alive = false; };
  }, [ready, caseId, sessionKey]);

  const submit = async () => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const response = await sessionFetch(`/api/finshield/cases/${caseId}/aftercare`, token, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ answers, base_passport_id: basePassport, contract_terms: terms }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(body?.error ?? "점검하지 못했습니다");
        return;
      }
      setResult(body as Result);
    } catch {
      setNotice("연결이 끊어졌습니다. 처리 결과를 확인한 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="가입 후 점검" />;

  if (loadedSession !== sessionKey) return <FsCard><p className="fs-body">저장된 점검 기록을 읽고 있습니다.</p></FsCard>;

  if (result) {
    const view = RESULT_VIEW[result.result]
      ?? { label: result.result, state: result.result, tone: "neutral" as const, lead: "" };
    return (
      <>
        <header>
          <p className="fs-eyebrow">가입 후 점검 결과{result.assessment_no ? ` · ${result.assessment_no}번째 점검` : ""}</p>
          {/* RES-005: 결론보다 행동을 먼저 놓는다. */}
          <h1 className="fs-h1 mt-2">{view.label}</h1>
          <div className="mt-3"><FsChip tone={view.tone}>{view.state}</FsChip></div>
          <p className="fs-lead mt-3">{view.lead}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet">기록으로 돌아가기</Link>
            <button type="button" className="fs-btn fs-btn--quiet" onClick={() => setResult(null)}>답변을 보완해 새 점검 만들기</button>
          </div>
        </header>

        {(result.comparison ?? []).length > 0 ? <FsCard className="mt-8">
          <h2 className="fs-h2">이전 권유와 계약 문구 비교</h2>
          <p className="fs-meta mt-2">입력한 문구의 차이입니다. 조건 변경이나 위법 여부의 확정 판단은 아닙니다.</p>
          <div className="mt-4 space-y-4">{result.comparison!.map(row => <section key={row.claim_id} className="border-t border-[var(--fs-line)] pt-3">
            <FsChip tone={row.result === "DIFFERENT_TEXT" ? "caution" : "neutral"}>
              {row.result === "DIFFERENT_TEXT" ? "문구 차이 · 확인 필요" : row.result === "SAME_TEXT" ? "입력 문구 일치" : "계약 문구 미입력"}
            </FsChip>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <p className="fs-body"><strong>이전 권유</strong><br />{row.before}</p>
              <p className="fs-body"><strong>입력한 계약 문구</strong><br />{row.contract || "확인하지 못했습니다."}</p>
            </div>
          </section>)}</div>
        </FsCard> : null}
        <FsCard className="mt-8">
          <h2 className="fs-h2">지금 하실 일</h2>
          <ul className="mt-4 space-y-5">
            {result.actions.map((action) => (
              <li key={action.action_code} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
                <p className="font-bold">{action.label}</p>
                <p className="fs-body mt-1">{action.detail}</p>
                {action.official_channel ? (
                  <p className="fs-meta mt-2">공식 창구: {action.official_channel}</p>
                ) : null}
                {action.required_material_codes.length > 0 ? (
                  <p className="fs-meta mt-1">
                    챙기실 자료: {action.required_material_codes
                      .map((code) => MATERIAL_LABEL[code] ?? code).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </FsCard>

        <FsCard>
          <h2 className="fs-h2">판단 이유</h2>
          <ul className="fs-body mt-3 list-disc space-y-2 pl-5">
            {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          <p className="fs-meta mt-4">
            이 점검은 답변과 이전 기록을 바탕으로 한 안내입니다. 사기·위법 여부를 확정하거나 금융·법률 상담을 대신하지 않습니다.
          </p>
        </FsCard>
      </>
    );
  }

  const answered = Object.keys(answers).length;

  return (
    <>
      <header>
        <p className="fs-eyebrow">가입 후 점검</p>
        <h1 className="fs-h1 mt-2">설명과 계약 조건을 점검하세요</h1>
        <p className="fs-lead mt-3">
          설명받은 내용과 이해한 정도, 실제 계약 조건의 차이를 확인합니다. 시험용 가상 상황으로 답해 주세요.
        </p>
        <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet mt-4">기록으로 돌아가기</Link>
      </header>

      {notice ? <FsCard className="mt-8"><p className="fs-body">{notice}</p></FsCard> : null}

      <FsCard className="mt-8">
        <h2 className="fs-h2">실제 계약서에 적힌 조건</h2>
        <p className="fs-body mt-2">이전 검증 기록의 문장과 비교할 계약 문구를 입력하세요. 시험용 합성 계약만 사용하고, 이름·계좌번호는 넣지 마세요.</p>
        <div className="mt-4 space-y-4">{prior.map(claim => <div key={claim.claim_id}>
          <label className="fs-label" htmlFor={`contract-${claim.claim_id}`}>이전 권유: {claim.statement_masked}</label>
          <textarea id={`contract-${claim.claim_id}`} rows={2} maxLength={400} className="fs-field"
            value={terms[claim.claim_id] ?? ""} placeholder="계약서의 대응 문구를 입력하세요. 없으면 비워 두세요."
            onChange={event => setTerms(prev => ({ ...prev, [claim.claim_id]: event.target.value }))} />
        </div>)}</div>
      </FsCard>
      <FsCard className="mt-8">
        <ul className="space-y-7">
          {QUESTIONS.map((question) => (
            <li key={question.code}>
              <p className="font-bold">{question.text}</p>
              {question.help ? <p className="fs-meta mt-1">{question.help}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={question.text}>
                {question.options.map((option) => {
                  const picked = answers[question.code] === option.value;
                  return (
                    <button key={option.value} type="button" aria-pressed={picked}
                      onClick={() => setAnswers((prev) => ({ ...prev, [question.code]: option.value }))}
                      className={`fs-btn !px-3 !text-[0.92rem] ${
                        picked ? "fs-btn--primary" : "fs-btn--quiet"}`}>
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <button type="button" disabled={busy || answered === 0 || !basePassport} onClick={() => void submit()}
            className="fs-btn fs-btn--primary">
            {busy ? "정리하는 중" : "점검 결과 보기"}
          </button>
          <p className="fs-meta mt-3">
            {answered}개 항목에 답하셨습니다. 답하지 않은 항목은 확인하지 못한 것으로 남기고,
            결과에도 그렇게 적습니다.
          </p>
        </div>
      </FsCard>
    </>
  );
}
