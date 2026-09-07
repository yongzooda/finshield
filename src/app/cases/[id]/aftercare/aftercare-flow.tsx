"use client";

import { sessionFetch } from "../../../session-client";

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

import { useState } from "react";
import Link from "next/link";
import { FsCard, FsChip, type ChipTone } from "../../../fs-shell";
import { FsLoginCard, useFsToken } from "../../../fs-session";
import { QUESTIONS } from "@/lib/finshield/aftercare";

type Action = {
  action_code: string; label: string; detail: string;
  required_material_codes: string[]; official_channel: string | null;
};
type Result = { result: string; reasons: string[]; actions: Action[] };

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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const submit = async () => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const response = await sessionFetch(`/api/finshield/cases/${caseId}/aftercare`, token, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
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

  if (result) {
    const view = RESULT_VIEW[result.result]
      ?? { label: result.result, state: result.result, tone: "neutral" as const, lead: "" };
    return (
      <>
        <header>
          <p className="fs-eyebrow">가입 후 점검 결과</p>
          {/* RES-005: 결론보다 행동을 먼저 놓는다. */}
          <h1 className="fs-h1 mt-2">{view.label}</h1>
          <div className="mt-3"><FsChip tone={view.tone}>{view.state}</FsChip></div>
          <p className="fs-lead mt-3">{view.lead}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet">기록으로 돌아가기</Link>
          </div>
        </header>

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
          <button type="button" disabled={busy || answered === 0} onClick={() => void submit()}
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
