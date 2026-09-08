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

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip, type ChipTone } from "../../../fs-shell";
import { FsLoginCard, useFsToken } from "../../../fs-session";
import { fetchCase } from "../../case-api";
import type { ContractComparison, PriorClaim } from "@/lib/finshield/contract-comparison";
import { AftercareInsights } from "./aftercare-insights";
import { AftercareDocuments } from "./aftercare-documents";
import { QUESTIONS } from "@/lib/finshield/aftercare";

type Action = {
  action_code: string; label: string; detail: string;
  required_material_codes: string[]; official_channel: string | null;
};
type Result = { assessment_no?: number; finished_at?: string; result: string; answers?: Record<string, string>; reasons: string[]; actions: Action[]; comparison?: ContractComparison[] };
type ReviewJob = { id: string; status: string; request_key: string; base_passport_id: string; reason_code: string | null;
  input_masked: { answers: { question_code: string; answer_code: string }[]; comparison: ContractComparison[] };
  agent_trace: { agent_code: string; status: string; tools: { tool_code: string; sources: { ref: string; title: string; url: string | null; excerpt_masked: string; reference_only: boolean }[] }[] }[] };

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
  const [documentLinks,setDocumentLinks]=useState<Record<string,string>>({});
  const [fileBusy,setFileBusy]=useState(false);
  const [busy, setBusy] = useState(false);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [reviewJob, setReviewJob] = useState<ReviewJob | null>(null);
  const requestKey = useRef<{ payload: string; id: string } | null>(null);

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
        setReviewJob(saved.review_job ?? null);
        setDocumentLinks(Object.fromEntries((saved.review_job?.input_masked?.document_sources??[]).map((s:{target_claim_id:string;id:string})=>[s.target_claim_id,s.id])));
        const passport = saved.review_job || assessment
          ? response.data.passports.find(row => row.id === (saved.review_job?.base_passport_id ?? assessment.base_passport_id))
          : response.data.passports[0];
        setBasePassport(passport?.id ?? null);
        setPrior(response.data.final_claims.filter(claim => claim.verification_run_id === passport?.verification_run_id));
        if (assessment) {
          setAnswers(assessment.answers);
          setTerms(Object.fromEntries(assessment.comparison.map((row: ContractComparison) => [row.claim_id, row.contract])));
          setResult(assessment);
        } else { setResult(null); setAnswers({}); setTerms({}); }
        if (saved.review_job && ["QUEUED", "RUNNING", "FAILED", "CANCELLED"].includes(saved.review_job.status)) {
          setAnswers(Object.fromEntries(saved.review_job.input_masked.answers
            .filter((a: { question_code: string }) => QUESTIONS.some(q => q.code === a.question_code))
            .map((a: { question_code: string; answer_code: string }) => [a.question_code, a.answer_code])));
          setTerms(Object.fromEntries(saved.review_job.input_masked.comparison.map((row: ContractComparison) => [row.claim_id, row.contract])));
        }
      } catch { if (alive) setNotice("이전 기록을 읽지 못했습니다. 다시 열어 주세요."); }
      finally { if (alive) setLoadedSession(sessionKey); }
    })();
    return () => { alive = false; };
  }, [ready, caseId, sessionKey]);

  const pending = reviewJob?.status === "QUEUED" || reviewJob?.status === "RUNNING";
  const activeReviewId = reviewJob?.id;
  useEffect(() => {
    if (!pending || !activeReviewId) return;
    let alive = true, inFlight = false;
    const poll = async () => {
      if (inFlight) return; inFlight = true;
      try {
        const current = readSessionToken();
        if (!current || sessionIdentity(current) !== sessionKey) return;
        const response = await sessionFetch(`/api/finshield/cases/${caseId}/aftercare?job_id=${activeReviewId}`, current);
        const body = await response.json();
        if (!alive || sessionIdentity(readSessionToken()) !== sessionKey) return;
        if (!response.ok) { setNotice(body.error ?? "점검 상태를 확인하지 못했습니다"); return; }
        setReviewJob(body.review_job ?? null);
        if (["FAILED", "CANCELLED"].includes(body.review_job?.status)) requestKey.current = null;
        if (body.assessment && ["COMPLETED", "PARTIAL"].includes(body.review_job?.status)) setResult(body.assessment);
      } catch { if (alive) setNotice("연결이 끊겼습니다. 저장된 진행 상태를 다시 확인하겠습니다."); }
      finally { inFlight = false; }
    };
    void poll(); const interval = setInterval(() => void poll(), 3000);
    return () => { alive = false; clearInterval(interval); };
  }, [pending, activeReviewId, caseId, sessionKey]);

  const operate = async (operation: "RESUME" | "CANCEL") => {
    if (!reviewJob || !token) return;
    setBusy(true);
    try {
      const response = await sessionFetch(`/api/finshield/cases/${caseId}/aftercare`, token, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, job_id: reviewJob.id }),
      });
      if (sessionIdentity(readSessionToken()) !== sessionKey) return;
      setNotice(response.ok ? "요청을 보냈습니다. 저장된 상태를 확인하고 있습니다." : "요청 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } catch { if (sessionIdentity(readSessionToken()) === sessionKey) setNotice("연결이 끊겼습니다. 진행 상태를 다시 확인하겠습니다."); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const payload = JSON.stringify({ answers, base_passport_id: basePassport, contract_terms: terms, document_links: documentLinks });
      if (requestKey.current?.payload !== payload) requestKey.current = { payload, id: crypto.randomUUID() };
      const response = await sessionFetch(`/api/finshield/cases/${caseId}/aftercare`, token, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(payload), request_key: requestKey.current.id }),
      });
      const body = await response.json().catch(() => null);
      if (sessionIdentity(readSessionToken()) !== sessionKey) return;
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(body?.error ?? "점검하지 못했습니다");
        return;
      }
      const restored = await sessionFetch(`/api/finshield/cases/${caseId}/aftercare?job_id=${body.review_job_id}`, token);
      const saved = await restored.json();
      if (sessionIdentity(readSessionToken()) !== sessionKey) return;
      if (!restored.ok) { setNotice("점검은 접수됐습니다. 화면을 다시 열면 진행 상태를 복원합니다."); return; }
      setReviewJob(saved.review_job ?? null);
      if (["FAILED", "CANCELLED"].includes(saved.review_job?.status)) requestKey.current = null;
      setResult(saved.assessment ?? null);
    } catch {
      if (sessionIdentity(readSessionToken()) === sessionKey) setNotice("연결이 끊어졌습니다. 처리 결과를 확인한 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="가입 후 점검" />;

  if (loadedSession !== sessionKey) return <FsCard><p className="fs-body">저장된 점검 기록을 읽고 있습니다.</p></FsCard>;

  if (pending) return <FsCard>
    <h1 className="fs-h2">설명·계약과 공식 자료를 점검하고 있습니다</h1>
    <p className="fs-body mt-3" role="status">{reviewJob?.status === "QUEUED" ? "점검 실행 대기 중" : "가입 후 Agent 검토 중"} · 화면을 닫아도 같은 Case에서 진행 상태를 복원합니다.</p>
    <p className="fs-meta mt-3">서류 원본은 본인 기기에 따로 보관해 주세요. 이 점검은 위법·사기를 확정하지 않습니다.</p>
    {notice ? <p className="fs-body mt-3">{notice}</p> : null}
    {reviewJob?.status === "QUEUED" ? <button type="button" disabled={busy} onClick={() => void operate("RESUME")} className="fs-btn fs-btn--quiet mt-4">대기 중인 요청 다시 연결</button> : null}
    <button type="button" disabled={busy} onClick={() => void operate("CANCEL")} className="fs-btn fs-btn--quiet mt-4">점검 중단</button>
    <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet mt-4">기록으로 돌아가기</Link>
  </FsCard>;

  if (result) {
    const view = RESULT_VIEW[result.result]
      ?? { label: result.result, state: result.result, tone: "neutral" as const, lead: "" };
    return (
      <>
        <header>
          <p className="fs-eyebrow">가입 후 점검 결과{result.assessment_no ? ` · ${result.assessment_no}번째 점검` : ""}</p>
          {/* RES-005: 결론보다 행동을 먼저 놓는다. */}
          <h1 className="fs-h1 mt-2">{result.result === "CORRECTION_OR_INQUIRY" && result.comparison?.some(row => row.result === "DIFFERENT_TEXT") ? "설명과 다른 계약 조건을 확인해 주세요" : view.label}</h1>
          <div className="mt-3"><FsChip tone={view.tone}>{view.state}</FsChip></div>
          <p className="fs-lead mt-3">{view.lead}</p>
          {reviewJob?.status === "PARTIAL" ? <p className="fs-body mt-3" role="status">Agent 조회·판단 중 일부를 확인하지 못했습니다. 아래 결과는 확보된 답변과 근거 범위의 안내입니다.</p> : null}
          {reviewJob && ["FAILED", "CANCELLED"].includes(reviewJob.status) ? <p className="fs-body mt-3" role="status">새 점검은 끝내지 못했습니다. 아래에는 이전에 저장한 점검 결과를 보여 줍니다.</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet">기록으로 돌아가기</Link>
            <button type="button" className="fs-btn fs-btn--quiet" onClick={() => { setResult(null); setReviewJob(null); requestKey.current = null; }}>답변을 보완해 새 점검 만들기</button>
          </div>
        </header>

        {result.result !== "DISPUTE_PREPARATION" ? <AftercareInsights key={result.assessment_no ?? "legacy"} comparison={result.comparison ?? []}
          answers={result.answers ?? answers}/> : null}
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

        {result.result === "DISPUTE_PREPARATION" ? <AftercareInsights key={result.assessment_no ?? "legacy"} comparison={result.comparison ?? []}
          answers={result.answers ?? answers} urgent/> : null}
        {reviewJob?.agent_trace?.length ? <FsCard>
          <h2 className="fs-h2">가입 후 검토 기록과 근거</h2>
          {reviewJob.agent_trace.map(agent => <section key={agent.agent_code} className="mt-4">
            <h3 className="font-bold">{agent.agent_code === "SALES_CONDUCT" ? "판매 설명 점검" : "규정·분쟁 자료 점검"} · {agent.status === "SUCCEEDED" && agent.tools.some(tool => tool.sources.length > 0) ? "공식 자료 조회 완료" : "일부 미확인"}</h3>
            <p className="fs-body mt-2">{agent.agent_code === "SALES_CONDUCT" ? "설명해야 할 내용과 권유 과정의 주의사항을 확인하기 위해 아래 자료를 조회했습니다. 실제로 설명했는지는 당시 상담 기록과 대조해야 합니다." : "계약 관련 확인 요청과 후속 절차를 검토하기 위해 아래 법령 자료를 조회했습니다. 조회 사실만으로 이 계약의 위법 여부가 확정되지는 않습니다."}</p>
            {agent.tools.flatMap(tool => tool.sources).map(source => <details key={source.ref} className="mt-3">
              <summary>{source.title}{source.reference_only ? " · 참고 사례" : ""}</summary>
              <p className="fs-body mt-2">{source.excerpt_masked}</p>
              {source.url && /^https?:\/\//.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer" className="fs-link">공식 원문 확인</a> : null}
            </details>)}
          </section>)}
        </FsCard> : null}
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
      {reviewJob && ["FAILED", "CANCELLED"].includes(reviewJob.status) ? <FsCard className="mt-8"><p className="fs-body">이전 점검은 끝내지 못했습니다. 보존된 답변을 확인해 새 점검을 시작할 수 있습니다. 이전 실행을 자동으로 다시 호출하지 않습니다.</p></FsCard> : null}

      <FsCard className="mt-8">
        <h2 className="fs-h2">실제 계약서에 적힌 조건</h2>
        <p className="fs-body mt-2">이전 검증 기록의 문장과 비교할 계약 문구를 입력하세요. 시험용 합성 계약만 사용하고, 이름·계좌번호는 넣지 마세요.</p>
        <div className="mt-4 space-y-4">{prior.map(claim => <div key={claim.claim_id}>
          <label className="fs-label" htmlFor={`contract-${claim.claim_id}`}>이전 권유: {claim.statement_masked}</label>
          <textarea id={`contract-${claim.claim_id}`} rows={2} maxLength={400} className="fs-field"
            value={terms[claim.claim_id] ?? ""} placeholder="계약서의 대응 문구를 입력하세요. 없으면 비워 두세요."
            onChange={event => {setTerms(prev => ({ ...prev, [claim.claim_id]: event.target.value }));setDocumentLinks(prev=>{const next={...prev};delete next[claim.claim_id];return next;});}} />
        </div>)}</div>
        {basePassport?<AftercareDocuments key={`${caseId}:${sessionKey}:${basePassport}`} token={token!} caseId={caseId} basePassport={basePassport} prior={prior}
          onBusyChange={setFileBusy} onUse={(values,links)=>{setTerms(old=>({...old,...values}));setDocumentLinks(old=>({...old,...links}));}}/>:null}
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
          <button type="button" disabled={busy || fileBusy || answered === 0 || !basePassport} onClick={() => void submit()}
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
