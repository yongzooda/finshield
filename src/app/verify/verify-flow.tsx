"use client";

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

import { useRef, useState } from "react";
import Link from "next/link";
import { CLAIM_STATE_VIEW, FsCard, FsChip } from "../fs-shell";
import { FsLoginCard, useFsToken } from "../fs-session";
import {
  AGENT_LABEL, DIRECTNESS_LABEL, FRESHNESS_LABEL, coveLabel, nextAction,
} from "../fs-labels";

type Claim = {
  claim_id: string; claim_ref: string; claim_type: string;
  statement_masked: string; materiality: string;
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

export function VerifyFlow() {
  const [token, setToken, ready] = useFsToken();
  const [step, setStep] = useState<"input" | "claims" | "running" | "result">("input");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<AgentLine[]>([]);
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [partial, setPartial] = useState(false);
  const [saved, setSaved] = useState(true);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [caseId, setCaseId] = useState<string | null>(null);
  // 마스킹한 문장은 이 화면 안에서만 들고 있는다. 저장소에 남기지 않는다.
  const masked = useRef("");

  const authed = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const submitText = async () => {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/finshield/intake", {
        method: "POST", headers: authed(), body: JSON.stringify({ text }),
      });
      const body = await response.json();
      if (!response.ok) { setNotice(body.error ?? "접수하지 못했습니다"); return; }
      if (body.blocked) { setNotice(body.ask); return; }
      setClaims(body.claims);
      setPicked(new Set(body.claims.filter((c: Claim) => c.materiality === "MATERIAL").map((c: Claim) => c.claim_id)));
      setCaseId(body.case_id as string);
      masked.current = body.masked_text ?? "";
      setStep("claims");
    } finally { setBusy(false); }
  };

  const startRun = async () => {
    setBusy(true); setNotice(null); setAgents([]); setStep("running");
    try {
      const response = await fetch("/api/finshield/verify", {
        method: "POST", headers: authed(),
        body: JSON.stringify({
          case_id: caseId,
          masked_text: masked.current,
          journey_stage: "PRE_TRANSACTION",
          claims: claims.filter((claim) => picked.has(claim.claim_id)),
        }),
      });
      if (!response.body) { setNotice("결과를 받지 못했습니다"); setStep("claims"); return; }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          const event = JSON.parse(line);
          if (event.type === "agent_started") {
            setAgents((prev) => prev.some((a) => a.agentCode === event.agentCode)
              ? prev : [...prev, { agentCode: event.agentCode, status: "RUNNING" }]);
          } else if (event.type === "agent_finished") {
            setAgents((prev) => prev.map((a) => a.agentCode === event.agentCode
              ? { ...a, status: event.status, findings: event.findings, toolCalls: event.toolCalls } : a));
          } else if (event.type === "done") {
            // 독립 검증까지 반영한 최종 상태를 쓴다. 저장된 값과 화면이 같아야 한다.
            const finals = (event.final_claims ?? []) as ClaimResult[];
            const merged = (event.claim_results as ClaimResult[]).map((base) => {
              const settled = finals.find((entry) => entry.claim_ref === base.claim_ref);
              return settled ? { ...base, ...settled } : base;
            });
            setSaved(event.saved !== false);
            setClaimResults(merged);
            setEvidence(event.evidence);
            setPartial(event.partial);
            setStep("result");
          } else if (event.type === "error") {
            setNotice(event.message); setStep("claims");
          }
        }
      }
    } finally { setBusy(false); }
  };

  const evidenceOf = (refs: string[]) => evidence.filter((item) => refs.includes(item.ref));
  const action = claimResults.length > 0 ? nextAction(claimResults.map((row) => row.state)) : null;

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} />;

  return (
    <div className="mt-8">
      {notice ? (
        <FsCard className="mb-4">
          <p className="fs-body">{notice}</p>
        </FsCard>
      ) : null}

      {step === "input" ? (
        <FsCard>
          <h2 className="fs-h2">권유받은 내용</h2>
          <p className="fs-body mt-2">문자나 통화로 들으신 내용을 그대로 붙여 넣어 주세요. 원문은 저장하지 않습니다.</p>
          <label className="sr-only" htmlFor="statement">권유받은 내용</label>
          <textarea id="statement" rows={9} value={text} onChange={(e) => setText(e.target.value)}
            className="fs-field mt-4" placeholder="예) 정부지원 햇살론15 승인 대상입니다. 연 3% 고정으로 2천만원까지 가능하고 오늘까지만 접수합니다." />
          <button type="button" disabled={busy || text.trim().length === 0} onClick={submitText}
            className="fs-btn fs-btn--primary mt-4">
            {busy ? "정리하는 중" : "확인할 항목 만들기"}
          </button>
        </FsCard>
      ) : null}

      {step === "claims" ? (
        <FsCard>
          <h2 className="fs-h2">무엇을 확인할까요</h2>
          <p className="fs-body mt-2">고르신 항목만 확인합니다. 사실과 다른 항목은 빼 주세요.</p>
          <ul className="mt-5 space-y-2">
            {claims.map((claim) => (
              <li key={claim.claim_id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[var(--fs-line)] px-4 py-3">
                  <input type="checkbox" className="mt-1.5" checked={picked.has(claim.claim_id)}
                    onChange={(e) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(claim.claim_id); else next.delete(claim.claim_id);
                      return next;
                    })} />
                  <span className="flex-1">
                    <span className="block leading-relaxed">{claim.statement_masked}</span>
                    <span className="mt-1.5 inline-block">
                      <FsChip tone={claim.materiality === "MATERIAL" ? "caution" : "neutral"}>
                        {claim.materiality === "MATERIAL" ? "거래에 영향이 큼" : "참고 항목"}
                      </FsChip>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy || picked.size === 0} onClick={startRun}
            className="fs-btn fs-btn--primary mt-5">확인 시작</button>
        </FsCard>
      ) : null}

      {step === "running" ? (
        <FsCard>
          <h2 className="fs-h2">확인하는 중</h2>
          <p className="fs-body mt-2">각 단계가 무엇을 하고 있는지 그대로 보여 드립니다.</p>
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
          {partial ? (
            <FsCard className="mb-4">
              <FsChip tone="caution">일부만 확인</FsChip>
              <p className="fs-body mt-2">
                끝까지 확인하지 못한 항목이 있습니다. 아래에서 확인한 범위와 확인하지 못한 범위를 함께 보실 수 있습니다.
              </p>
            </FsCard>
          ) : null}

          {/* RES-005: 결론보다 행동을 먼저 놓는다. */}
          <FsCard>
            <p className="fs-eyebrow">지금 하실 일</p>
            <h2 className="fs-h2 mt-2">{action.title}</h2>
            <p className="fs-body mt-2">{action.detail}</p>
          </FsCard>

          <FsCard>
            <h2 className="fs-h2">항목별 확인 결과</h2>
            <ul className="mt-5 space-y-5">
              {claimResults.map((result) => {
                const claim = claims.find((item) => item.claim_ref === result.claim_ref);
                const view = CLAIM_STATE_VIEW[result.state] ?? { label: result.state, tone: "neutral" as const, help: "" };
                const items = evidenceOf(result.evidence_refs);
                const isOpen = opened.has(result.claim_ref);
                return (
                  <li key={result.claim_ref} className="border-t border-[var(--fs-line)] pt-5 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="max-w-xl leading-relaxed">{claim?.statement_masked ?? result.claim_ref}</p>
                      <FsChip tone={view.tone}>{view.label}</FsChip>
                    </div>
                    <p className="fs-body mt-2">{result.rationale_masked}</p>
                    {result.withheld_reason ? <p className="fs-meta mt-1">{result.withheld_reason}</p> : null}
                    <p className="fs-meta mt-1">{view.help}</p>
                    {result.cove_status && result.cove_status !== "NOT_REQUIRED" ? (
                      <p className="fs-meta mt-1">
                        독립 재확인 {coveLabel(result.cove_status)}
                        {result.red_team_status === "COUNTER_EVIDENCE" ? " · 반대 근거 있음" : ""}
                      </p>
                    ) : null}
                    {items.length > 0 ? (
                      <>
                        <button type="button" className="fs-btn fs-btn--quiet mt-3 !min-h-0 !px-3 !py-1.5 !text-[0.9rem]"
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
                판단과 근거는 덮어쓰지 않고 판을 쌓습니다. 나중에 다시 열어 무엇을 보고 그렇게 판단했는지 확인하실 수 있습니다.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--primary">기록 열기</Link>
                <Link href={`/cases/${caseId}/passport`} className="fs-btn fs-btn--quiet">Evidence Passport</Link>
              </div>
            </FsCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
