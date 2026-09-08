"use client";

import { sessionFetch } from "../session-client";

/**
 * 거래 전 검증 흐름 (S-006·S-008·S-009·S-010·S-011).
 *
 * 진행 표시에 백분율을 쓰지 않는다. 실제로 어느 Agent 가 시작하고 끝났는지만
 * 보여 준다 (S-009). 결과에는 0~100 점수를 만들지 않는다 (RES-002).
 *
 * 결과는 행동을 먼저 보여 주고 그다음에 결론을 놓는다 (RES-005). 온전히 끝나지
 * 않았으면 그 사실을 맨 위에 알린다 (RES-008).
 *
 * 판단마다 근거를 열 수 있다 (EV-001). 근거에는 출처와 등급과 발행일과 조회
 * 시각과 판 정보와 본문 해시를 함께 적는다 (EV-002).
 */

import { useEffect, useRef, useState } from "react";
import { FileIntake } from "./file-intake";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readRunStream } from "../run-stream";
import { claimViewOf, FsCard, FsChip } from "../fs-shell";
import { AxisLimitations, ClaimBadges, ClaimReviewDetails, ResultScopeNote, ReviewNotice } from "../result-explanation";
import { FsLoginCard, useFsToken } from "../fs-session";
import {
  AGENT_LABEL, AXIS_LABEL, axisResultOf, DIRECTNESS_LABEL, FRESHNESS_LABEL, nextAction,
} from "../fs-labels";
import { resolveInitialRunRecovery } from "./run-recovery";

type Claim = {
  claim_id: string; claim_ref: string; claim_type: string; expected_revision_no?: number;
  statement_masked: string; materiality: string; source_page_no?: number;
};
type Evidence = {
  ref: string; title: string; source: string; grade: string; official_id: string | null;
  url: string | null; published_at: string | null; fetched_at?: string | null;
  version?: string | null; content_hash?: string | null; freshness: string;
  directness: string; reference_only: boolean; excerpt: string;
};
type ClaimResult = {
  claim_ref: string; state: string; evidence_refs: string[];
  withheld_reason: string | null; rationale_masked: string;
  /** 독립 재확인과 반대 근거 찾기의 결과. 확정을 낮춘 이유가 여기 남는다. */
  cove_status?: string; red_team_status?: string; reason_code?: string;
};
type AgentLine = { agentCode: string; status: string; findings?: number; toolCalls?: number };

const STAGE_ORDER = ["INPUT_CREATED", "VALIDATED", "EXTRACTED", "MASKED", "CLAIMS_EXTRACTED"] as const;
const STAGE_LABEL: Record<string, string> = {
  INPUT_CREATED: "입력을 받았습니다",
  VALIDATED: "형식과 크기를 확인했습니다",
  EXTRACTED: "문장을 읽었습니다",
  MASKED: "개인정보를 가렸습니다",
  CLAIMS_EXTRACTED: "확인할 항목을 뽑았습니다",
};

/** 단계마다 덧붙일 한 줄. 원문은 넣지 않는다. */
function stageDetail(event: { stage: string; masked_count?: number; claim_count?: number }): string {
  if (event.stage === "MASKED") return `${event.masked_count ?? 0}곳을 가렸습니다`;
  if (event.stage === "CLAIMS_EXTRACTED") return `${event.claim_count ?? 0}개 항목`;
  return "";
}

export function VerifyFlow() {
  const router = useRouter();
  const [token, setToken, ready] = useFsToken();
  const [step, setStep] = useState<"input" | "extracting" | "claims" | "running" | "result">("input");
  const [stages, setStages] = useState<{ stage: string; detail: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const intakeAbort = useRef<AbortController | null>(null);
  const verifyAbort = useRef<AbortController | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  useEffect(() => () => {
    intakeAbort.current?.abort();
    verifyAbort.current?.abort();
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [filePages,setFilePages] = useState<{page_no:number;text:string}[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<AgentLine[]>([]);
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [officialChannels, setOfficialChannels] = useState<{ display_value: string }[]>([]);
  const [axes, setAxes] = useState<{ axis: string; result_code: string; summary_masked: string; limitation_codes?: string[] | null }[]>([]);
  const [reviewReasons, setReviewReasons] = useState<string[]>([]);
  const [partial, setPartial] = useState(false);
  const [saved, setSaved] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [caseId, setCaseId] = useState<string | null>(null);
  const [inputId, setInputId] = useState<string | null>(null);
  // 마스킹한 문장은 이 화면 안에서만 들고 있는다. 저장소에 남기지 않는다.
  const masked = useRef("");

  const authed = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const submitText = async () => {
    if (!token) { setNotice("다시 로그인해 주세요"); return; }
    const controller = new AbortController(); intakeAbort.current = controller;
    setBusy(true); setNotice(null); setStages([]); setFilePages([]); setStep("extracting");
    try {
      const response = await sessionFetch("/api/finshield/intake", token, {
        method: "POST", headers: authed(), body: JSON.stringify({ text }), signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setNotice(body?.error ?? "접수하지 못했습니다"); setStep("input"); return;
      }
      await readRunStream(response, (line) => {
          const event = JSON.parse(line);
          if (event.type === "stage") {
            setStages((prev) => [...prev, { stage: event.stage, detail: stageDetail(event) }]);
            if (event.stage === "INPUT_CREATED") {
              setCaseId(event.case_id as string);
              setInputId(event.input_id as string);
            }
          } else if (event.type === "blocked") {
            setNotice(event.ask); setStep("input");
          } else if (event.type === "done") {
            setClaims(event.claims);
            setPicked(new Set(event.claims
              .filter((c: Claim) => c.materiality === "MATERIAL").map((c: Claim) => c.claim_id)));
            setCaseId(event.case_id as string);
            setInputId(event.input_id as string);
            masked.current = event.masked_text ?? "";
            setStep("claims");
          } else if (event.type === "error") {
            setNotice(event.message); setStep("input");
          }
      });
    } catch {
      setNotice("연결이 끊어졌습니다. 다시 시도해 주세요."); setStep("input");
    } finally { intakeAbort.current = null; setBusy(false); }
  };

  /** 사용자가 중단하면 원본을 지우기 시작한다. 화면에서 물러나는 것이 아니다 (규칙 4). */
  const stopInput = async () => {
    intakeAbort.current?.abort();
    verifyAbort.current?.abort();
    if (!token) { setNotice("다시 로그인해 주세요"); return; }
    if (!caseId || !inputId) { setStep("input"); return; }
    setStopping(true);
    setBusy(true);
    try {
      const response = await sessionFetch(`/api/finshield/cases/${caseId}/stop`, token, {
        method: "POST", headers: authed(), body: JSON.stringify({ input_id: inputId }),
      });
      const body = await response.json().catch(() => null);
      setNotice(response.ok
        ? "중단했습니다. 올리신 내용은 지우기 시작했습니다."
        : (body?.error ?? "중단하지 못했습니다"));
    } catch {
      setNotice("중단 요청을 확인하지 못했습니다. 내 기록에서 처리 상태를 확인해 주세요.");
    } finally {
      setStopping(false);
      setBusy(false);
      setClaims([]); setPicked(new Set()); setStages([]);
      setCaseId(null); setInputId(null); setActiveRunId(null); masked.current = "";
      setStep("input");
    }
  };

  const startRun = async () => {
    if (!token) { setNotice("다시 로그인해 주세요"); return; }
    const controller = new AbortController();
    verifyAbort.current = controller;
    let streamedRunId = activeRunId;
    let receivedTerminal = false;
    setBusy(true); setNotice(null); setAgents([]); setStep("running");
    try {
      const response = await sessionFetch("/api/finshield/verify", token, {
        method: "POST", headers: authed(), signal: controller.signal,
        body: JSON.stringify({
          case_id: caseId,
          ...(activeRunId ? { replace_run_id: activeRunId } : {}),
          claims: claims.filter((claim) => picked.has(claim.claim_id)),
        }),
      });
      if (!response.ok || !response.body) {
        const error = await response.json().catch(() => null);
        if (response.status === 401) setToken(null);
        setNotice(error?.error ?? "검증을 시작하지 못했습니다."); setStep("claims"); return;
      }
      await readRunStream(response, (line) => {
          const event = JSON.parse(line);
          if (event.type === "run_started" && event.claims) {
            streamedRunId = event.run_id as string;
            setActiveRunId(event.run_id as string);
            setClaims(event.claims);
          } else if (event.type === "agent_started") {
            setAgents((prev) => prev.some((a) => a.agentCode === event.agentCode)
              ? prev : [...prev, { agentCode: event.agentCode, status: "RUNNING" }]);
          } else if (event.type === "agent_finished") {
            setAgents((prev) => prev.map((a) => a.agentCode === event.agentCode
              ? { ...a, status: event.status, findings: event.findings, toolCalls: event.toolCalls } : a));
          } else if (event.type === "done") {
            // 독립 검증까지 반영한 최종 상태를 쓴다. 저장된 값과 화면이 같아야 한다.
            const finals = (event.final_claims ?? []) as (Omit<ClaimResult, "evidence_refs" | "withheld_reason" | "rationale_masked"> & { summary_masked: string })[];
            const merged = finals.map((settled) => {
              const base = (event.claim_results as ClaimResult[]).find(entry => entry.claim_ref === settled.claim_ref);
              return { evidence_refs: base?.evidence_refs ?? [], withheld_reason: base?.withheld_reason ?? null,
                ...settled, rationale_masked: settled.summary_masked };
            });
            setAxes(event.axes ?? []);
            setOfficialChannels(event.guide?.channels ?? []);
            setSaved(event.saved !== false);
            setClaimResults(merged);
            setEvidence(event.evidence);
            setPartial(event.partial);
            setReviewReasons([
              ...(event.agents ?? []).flatMap((agent: { agentCode: string; status: string; reasonCode?: string }) =>
                agent.status === "SUCCEEDED" ? [] : [agent.reasonCode ?? "AGENT_PARTIAL", `AGENT_${agent.agentCode}_PARTIAL`]),
              ...(event.judge_reason_code ? [event.judge_reason_code] : []),
            ]);
            setActiveRunId(null);
            setStep("result");
            receivedTerminal = true;
          } else if (event.type === "error") {
            receivedTerminal = true;
            setNotice(event.message); setStep("claims");
          }
      });
    } catch {
      if (controller.signal.aborted) return;
      if (!receivedTerminal && streamedRunId && caseId) {
        let recovery: ReturnType<typeof resolveInitialRunRecovery> = { kind: "UNKNOWN" };
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 750));
          const response = await sessionFetch(`/api/finshield/cases/${caseId}`, token, {
            headers: authed(), signal: AbortSignal.timeout(5_000),
          }).catch(() => null);
          if (!response?.ok) continue;
          const detail = await response.json().catch(() => null);
          recovery = resolveInitialRunRecovery(detail ?? {}, streamedRunId);
          if (recovery.kind !== "PENDING") break;
        }
        if (recovery.kind === "PASSPORT") {
          router.push(`/cases/${caseId}/passport?passport_id=${recovery.passportId}`);
          return;
        }
        setActiveRunId(streamedRunId);
        setNotice(recovery.kind === "RETRY" && recovery.reasonCode === "DEADLINE_EXCEEDED"
          ? "제한 시간 안에 검증을 끝내지 못했습니다. 같은 항목으로 다시 시도해 주세요."
          : recovery.kind === "RETRY" && recovery.reasonCode === "CLIENT_DISCONNECTED"
            ? "연결이 끊겨 검증을 안전하게 중단했습니다. 같은 항목으로 다시 시도해 주세요."
            : recovery.kind === "PENDING"
              ? "연결은 끊겼고 서버가 실행 상태를 정리하고 있습니다. 잠시 후 같은 항목으로 다시 시도해 주세요."
              : "완료 결과를 받지 못했습니다. 내 기록에서 처리 상태를 확인하거나 같은 항목으로 다시 시도해 주세요.");
        setStep("claims");
      } else if (!receivedTerminal) {
        setNotice("완료 결과를 받지 못했습니다. 내 기록에서 처리 상태를 확인해 주세요."); setStep("claims");
      }
    } finally {
      if (verifyAbort.current === controller) verifyAbort.current = null;
      setBusy(false);
    }
  };

  const evidenceOf = (refs: string[]) => evidence.filter((item) => refs.includes(item.ref));
  const action = claimResults.length > 0 ? nextAction(claimResults.map((row) => row.state), axes.some(axis => axis.result_code === "HIGH_RISK_ACTION")) : null;

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} />;

  return (
    <div className="mt-7">
      <ol className="fs-flow-progress" aria-label="검증 순서">
        {["내용 입력", "항목 확인", "결과 확인"].map((label, index) => {
          const current = step === "input" || step === "extracting" ? 0 : step === "claims" ? 1 : 2;
          return <li key={label} aria-current={current === index ? "step" : undefined}>{index + 1}. {label}</li>;
        })}
      </ol>
      {notice ? (
        <FsCard className="mb-4">
          <p className="fs-body" role="alert">{notice}</p>
        </FsCard>
      ) : null}

      {step === "input" ? (
        <FsCard>
          <h2 className="fs-h2">권유받은 내용</h2>
          <p className="fs-body mt-2">햇살론15 관련 가상 권유문을 붙여 넣어 주세요.</p>
          <label className="sr-only" htmlFor="statement">권유받은 내용</label>
          <p className="fs-inline-notice mt-4">시험 서비스입니다. 실제 개인정보와 금융 서류는 입력하지 마세요.</p>
          <textarea id="statement" maxLength={4000} rows={7} value={text} onChange={(e) => setText(e.target.value)}
            className="fs-field mt-4" placeholder="예) 정부지원 햇살론15 승인 대상입니다. 연 3% 고정으로 2천만원까지 가능하고 오늘까지만 접수합니다." />
          <button type="button" disabled={busy || fileBusy || text.trim().length === 0} onClick={submitText}
            className="fs-btn fs-btn--primary mt-4">
            {busy ? "정리하는 중" : "다음 · 확인 항목 선택"}
          </button>
          <FileIntake token={token} onBusyChange={setFileBusy} onPrepared={result=>{
            setClaims(result.claims);setPicked(new Set(result.claims.filter(c=>c.materiality==="MATERIAL").map(c=>c.claim_id)));
            setCaseId(result.case_id);setInputId(result.input_id);masked.current=result.masked_text;
            setFilePages(result.masked_pages);setNotice(null);setStep("claims");
          }}/>
        </FsCard>
      ) : null}

      {step === "extracting" ? (
        <FsCard>
          <h2 className="fs-h2">정리하는 중</h2>
          <p className="fs-body mt-2">
            문장에서 상품 조건과 확인할 내용을 정리하고 있습니다.
          </p>
          <ul className="fs-steps mt-5" aria-live="polite">
            {STAGE_ORDER.map((stage) => {
              const done = stages.find((entry) => entry.stage === stage);
              const running = !done && stages.length === STAGE_ORDER.indexOf(stage);
              if (!done && !running) return null;
              return (
                <li key={stage} data-state={done ? "done" : "running"}>
                  <span className="font-bold">{STAGE_LABEL[stage] ?? stage}</span>
                  {done?.detail ? <span className="fs-meta ml-2">{done.detail}</span> : null}
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => void stopInput()}
              className="fs-btn fs-btn--quiet">중단하고 지우기</button>
          </div>
        </FsCard>
      ) : null}

      {step === "claims" ? (
        <FsCard>
          <h2 className="fs-h2">무엇을 확인할까요</h2>
          <p className="fs-body mt-2">받은 권유와 같은 내용인지 확인하고 검증할 항목을 선택해 주세요. 입력과 다르게 추출됐다면 아래 문장을 직접 고쳐 주세요. 수정한 문장도 개인정보를 가린 뒤 기록합니다.</p>
          {activeRunId ? <p className="fs-inline-notice mt-4">이전 검증이 중단되었습니다. 같은 항목으로 다시 시작할 수 있습니다.</p> : null}
          {filePages.length ? <details className="mt-4 rounded-lg border border-[var(--fs-line)] p-4">
            <summary className="cursor-pointer font-bold">페이지별 추출 내용과 대조하기</summary>
            {filePages.map(page=><section className="mt-4" key={page.page_no}><h3 className="font-bold">{page.page_no}쪽</h3>
              <p className="fs-body mt-2 whitespace-pre-wrap">{page.text}</p></section>)}
          </details> : null}
          <ul className="mt-5 space-y-2">
            {claims.map((claim) => (
              <li key={claim.claim_id}>
                <div className="flex items-start gap-3 rounded-[10px] border border-[var(--fs-line)] px-4 py-3">
                  <input type="checkbox" aria-label={`${claim.claim_ref} 검증 대상으로 선택`} className="mt-1.5" checked={picked.has(claim.claim_id)}
                    onChange={(e) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(claim.claim_id); else next.delete(claim.claim_id);
                      return next;
                    })} />
                  <span className="flex-1">
                    {claim.source_page_no ? <span className="fs-meta">원문 {claim.source_page_no}쪽</span> : null}
                    <textarea aria-label={`${claim.claim_ref} 확인 문장 수정`} className="fs-field" rows={2}
                      maxLength={400} value={claim.statement_masked}
                      onChange={event => setClaims(prev => prev.map(item => item.claim_id === claim.claim_id
                        ? { ...item, statement_masked: event.target.value } : item))} />
                    <span className="mt-1.5 inline-block">
                      <FsChip tone={claim.materiality === "MATERIAL" ? "caution" : "neutral"}>
                        {claim.materiality === "MATERIAL" ? "거래에 영향이 큼" : "참고 항목"}
                      </FsChip>
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={busy || picked.size === 0 || claims.some(claim => picked.has(claim.claim_id) && !claim.statement_masked.trim())} onClick={startRun}
              className="fs-btn fs-btn--primary">{activeRunId ? "같은 항목 다시 검증하기" : "선택한 항목 검증하기"}</button>
            <button type="button" disabled={busy} onClick={() => void stopInput()}
              className="fs-btn fs-btn--quiet">중단하고 다시 입력</button>
          </div>
          <p className="fs-meta mt-3">
            중단하시면 올리신 내용을 지우기 시작합니다. 확인한 항목만 남습니다.
          </p>
        </FsCard>
      ) : null}

      {step === "running" ? (
        <FsCard>
          <h2 className="fs-h2">확인하는 중</h2>
          <p className="fs-body mt-2">공식 자료를 조회하고 판단 근거를 검토하고 있습니다.</p>
          <ul className="fs-steps mt-5" aria-live="polite">
            {agents.map((agent) => (
              <li key={agent.agentCode} data-state={agent.status === "RUNNING" ? "running" : "done"}>
                <span className="font-bold">{AGENT_LABEL[agent.agentCode] ?? agent.agentCode}</span>
                <span className="fs-meta ml-2">
                  {agent.status === "RUNNING" ? "확인 중"
                    : `${agent.status === "SUCCEEDED" ? "완료" : "일부만 확인"} · 자료 조회 ${agent.toolCalls ?? 0}회`}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" disabled={stopping} onClick={() => void stopInput()}
            className="fs-btn fs-btn--quiet mt-5">{stopping ? "중단하는 중" : "중단하고 올린 내용 지우기"}</button>
        </FsCard>
      ) : null}

      {step === "result" && action ? (
        <div>
          {!saved ? (
            <FsCard className="mb-4">
              <FsChip tone="caution">저장 실패</FsChip>
              <p className="fs-body mt-2">
                결과를 기록으로 남기지 못했습니다. 아래 내용은 이번 화면에서만 보실 수 있습니다.
              </p>
            </FsCard>
          ) : null}
          {/* RES-005: 결론보다 행동을 먼저 놓는다. */}
          <FsCard>
            <p className="fs-eyebrow">지금 하실 일</p>
            <h2 className="fs-h2 mt-2">{action.title}</h2>
            <p className="fs-body mt-2">{action.detail}</p>
            {officialChannels.map(channel => <p key={channel.display_value} className="fs-body mt-3 font-semibold">공식 확인 창구: {channel.display_value}</p>)}
          </FsCard>

          {partial ? <ReviewNotice status="PARTIAL" reasons={reviewReasons} /> : null}
          <FsCard>
            <h2 className="fs-h2">세 가지 확인 결과</h2>
            {axes.length === 0 ? <p className="fs-body mt-3" role="status">{saved ? "저장된 축 결과를 이번 응답에서 읽지 못했습니다. 내 기록의 Passport에서 확인해 주세요." : "축 결과가 저장되지 않아 확정된 판단으로 표시하지 않습니다."}</p> : null}
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {axes.map(axis => <section key={axis.axis}>
                <h3 className="font-bold">{AXIS_LABEL[axis.axis]}</h3>
                <FsChip tone={axisResultOf(axis.result_code, axis.axis).tone}>{axisResultOf(axis.result_code, axis.axis).label}</FsChip>
                <p className="fs-meta mt-2">{axis.summary_masked}</p>
                <AxisLimitations codes={axis.limitation_codes} />
              </section>)}
            </div>
          </FsCard>
          <FsCard>
            <h2 className="fs-h2">항목별 확인 결과</h2>
            <ResultScopeNote />
            <ul className="mt-5 space-y-5">
              {claimResults.map((result) => {
                const claim = claims.find((item) => item.claim_ref === result.claim_ref);
                const view = claimViewOf(result.state, result.reason_code);
                const items = evidenceOf(result.evidence_refs);
                const isOpen = opened.has(result.claim_ref);
                return (
                  <li key={result.claim_ref} className="border-t border-[var(--fs-line)] pt-5 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="max-w-xl leading-relaxed">{claim?.statement_masked ?? result.claim_ref}</p>
                      <ClaimBadges status={result.state} reason={result.reason_code} />
                    </div>
                    <p className="fs-body mt-2">{result.rationale_masked}</p>
                    {result.withheld_reason ? <p className="fs-meta mt-1">{result.withheld_reason}</p> : null}
                    <p className="fs-meta mt-1">{view.help}</p>
                    <ClaimReviewDetails reason={result.reason_code} cove={result.cove_status} redTeam={result.red_team_status} />
                    {items.length > 0 ? (
                      <>
                        <button type="button" className="fs-btn fs-btn--quiet mt-3 !px-3 !text-[0.9rem]"
                          aria-expanded={isOpen}
                          onClick={() => setOpened((prev) => {
                            const next = new Set(prev);
                            if (next.has(result.claim_ref)) next.delete(result.claim_ref);
                            else next.add(result.claim_ref);
                            return next;
                          })}>
                          {isOpen ? "근거 접기" : `근거 ${items.length}건 보기`}
                        </button>
                        {isOpen ? (
                          <ul className="mt-3 space-y-3">
                            {items.map((item) => (
                              <li key={item.ref} className="rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <FsChip tone="neutral">{item.ref}</FsChip>
                                  <FsChip tone={item.grade === "A" ? "verified" : "neutral"}>권위 {item.grade}</FsChip>
                                  <FsChip tone={item.freshness === "FRESH" ? "verified" : "caution"}>
                                    {FRESHNESS_LABEL[item.freshness] ?? item.freshness}
                                  </FsChip>
                                  {item.reference_only ? <FsChip tone="caution">참고용</FsChip> : null}
                                </div>
                                <p className="mt-2 font-bold">{item.title}</p>
                                <p className="fs-body mt-1">{item.excerpt}</p>
                                {/* EV-002: 출처를 되짚을 수 있는 값을 모두 적는다. */}
                                <dl className="fs-meta mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                  <dt>출처 종류</dt><dd>{item.source} · {DIRECTNESS_LABEL[item.directness] ?? item.directness}</dd>
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
          </FsCard>

          {saved && caseId ? (
            <FsCard>
              <h2 className="fs-h2">이 결과는 기록으로 남았습니다</h2>
              <p className="fs-body mt-2">
                내 기록에서 결과와 근거를 다시 보고, 재검증이나 가입 후 점검을 이어갈 수 있습니다.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--primary">기록 열기</Link>
                <Link href={`/cases/${caseId}/passport`} className="fs-btn fs-btn--quiet">검증 근거 기록</Link>
              </div>
            </FsCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
