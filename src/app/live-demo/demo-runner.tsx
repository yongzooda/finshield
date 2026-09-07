"use client";

/**
 * 공개 Live Seed Demo (S-001).
 *
 * 로그인 없이 실제 파이프라인을 한 번 돌려 본다. 방문자의 문장은 받지 않는다.
 * 미리 승인한 합성 Seed 하나만 돌린다. 그래서 개인정보를 넣을 자리가 없다.
 *
 * 실행 모드를 배지로 적는다. 사전 계산 결과를 실시간 실행처럼 보이지 않게 하기
 * 위해서다 (OPS-004).
 */

import { useState } from "react";
import Link from "next/link";
import { readRunStream } from "../run-stream";
import { FsCard, FsChip, CLAIM_STATE_VIEW } from "../fs-shell";
import { AGENT_LABEL, DIRECTNESS_LABEL, FRESHNESS_LABEL } from "../fs-labels";

type Claim = { claim_ref: string; statement_masked: string; materiality: string };
type AgentLine = { agentCode: string; status: string; toolCalls?: number };
type Evidence = {
  ref: string; title: string; source: string; grade: string; official_id: string | null;
  url: string | null; published_at: string | null; fetched_at: string | null;
  content_hash: string | null; freshness: string; directness: string;
  reference_only: boolean; excerpt: string;
};
type Result = {
  seed_version: string; partial: boolean; is_precomputed: boolean;
  claims: { claim_ref: string; statement_masked: string; state: string;
    rationale_masked: string; evidence_refs: string[] }[];
  evidence: Evidence[];
};

export function DemoRunner() {
  const [step, setStep] = useState<"idle" | "running" | "done">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [seedText, setSeedText] = useState<string | null>(null);
  const [seedClaims, setSeedClaims] = useState<Claim[]>([]);
  const [agents, setAgents] = useState<AgentLine[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const start = async () => {
    setNotice(null); setAgents([]); setResult(null); setStep("running");
    try {
      const response = await fetch("/api/finshield/demo", { method: "POST" });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setNotice(body?.error ?? "실행하지 못했습니다");
        setStep("idle");
        return;
      }
      await readRunStream(response, (line) => {
        const event = JSON.parse(line);
          if (event.type === "started") {
            setSeedText(event.masked_input as string);
            setSeedClaims(event.claims as Claim[]);
          } else if (event.type === "agent_started") {
            setAgents((prev) => prev.some((a) => a.agentCode === event.agentCode)
              ? prev : [...prev, { agentCode: event.agentCode, status: "RUNNING" }]);
          } else if (event.type === "agent_finished") {
            setAgents((prev) => prev.map((a) => a.agentCode === event.agentCode
              ? { ...a, status: event.status, toolCalls: event.toolCalls } : a));
          } else if (event.type === "done") {
            setResult(event as Result);
            setStep("done");
          } else if (event.type === "error") {
            setNotice(event.message); setStep("idle");
          }
      });
    } catch {
      setNotice("완료 결과를 받지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.");
      setStep("idle");
    }
  };

  const evidenceOf = (refs: string[]) => (result?.evidence ?? []).filter((item) => refs.includes(item.ref));

  return (
    <>
      <header>
        <p className="fs-eyebrow">서비스 체험</p>
        <h1 className="fs-h1 mt-2">대출 권유, 어떻게 확인할까요?</h1>
        <p className="fs-lead mt-3">준비된 가상 문자로 검증 과정과 공식 근거를 확인해 보세요. 회원가입은 필요하지 않습니다.</p>
      </header>

      {notice ? <FsCard><p role="alert" className="fs-body">{notice}</p></FsCard> : null}

      {seedText ? (
        <FsCard>
          <h2 className="fs-h2">넣은 내용</h2>
          <p className="fs-meta mt-1">체험용 가상 권유문입니다.</p>
          <p className="fs-body mt-3 whitespace-pre-wrap rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
            {seedText}
          </p>
          {seedClaims.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {seedClaims.map((claim) => (
                <li key={claim.claim_ref} className="fs-body">
                  · {claim.statement_masked}
                  {claim.materiality === "MATERIAL" ? (
                    <span className="ml-2"><FsChip tone="caution">거래에 영향이 큼</FsChip></span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </FsCard>
      ) : null}

      {step === "idle" ? (
        <FsCard>
          <h2 className="fs-h2">가상 대출 문자 확인</h2>
          <p className="fs-body mt-2">
            시작하면 공식 자료를 조회해 항목별 결과를 만듭니다. 체험은 한 시간에 세 번까지 가능합니다.
          </p>
          <button type="button" onClick={() => void start()} className="fs-btn fs-btn--primary mt-4">
            체험 시작하기
          </button>
        </FsCard>
      ) : null}

      {step === "running" ? (
        <FsCard>
          <h2 className="fs-h2">확인하는 중</h2>
          <p className="fs-body mt-2">공식 자료 조회와 독립 검토에 보통 약 1분이 걸립니다. 아래 단계가 계속 갱신됩니다.</p>
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
            {agents.length === 0 ? <li data-state="running"><span>준비하는 중</span></li> : null}
          </ul>
        </FsCard>
      ) : null}

      {step === "done" && result ? (
        <>
          <FsCard>
            <div className="flex flex-wrap items-center gap-3">
              <FsChip tone={result.is_precomputed ? "caution" : "verified"}>{result.is_precomputed ? "사전 계산 결과" : "실제 실행 결과"}</FsChip>
              <span className="fs-meta">체험 자료 {result.seed_version}</span>
              {result.partial ? <FsChip tone="caution">일부만 확인</FsChip> : null}
            </div>
            <h2 className="fs-h2 mt-3">항목별 확인 결과</h2>
            <p className="fs-body mt-2">
              {result.is_precomputed ? "미리 계산된 결과입니다. 현재 실행 결과와 구분해 확인해 주세요." : "이번에 조회한 자료를 바탕으로 확인한 결과입니다."}
            </p>
            <ul className="mt-5 space-y-5">
              {result.claims.map((claim) => {
                const view = CLAIM_STATE_VIEW[claim.state]
                  ?? { label: claim.state, tone: "neutral" as const, help: "" };
                const items = evidenceOf(claim.evidence_refs);
                const isOpen = opened.has(claim.claim_ref);
                return (
                  <li key={claim.claim_ref} className="border-t border-[var(--fs-line)] pt-5 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="max-w-xl leading-relaxed">{claim.statement_masked}</p>
                      <FsChip tone={view.tone}>{view.label}</FsChip>
                    </div>
                    <p className="fs-body mt-2">{claim.rationale_masked}</p>
                    <p className="fs-meta mt-1">{view.help}</p>
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

          <FsCard>
            <h2 className="fs-h2">여기서 남은 것</h2>
            <p className="fs-body mt-2">
              이 실행은 격리된 자리에만 기록했습니다. 회원 Case 도, 프로필도, 입력도 만들지 않았습니다.
              Session 은 시간이 지나면 스스로 지워집니다.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/verify" className="fs-btn fs-btn--primary">내 건으로 확인하기</Link>
              <Link href="/trust" className="fs-btn fs-btn--quiet">무엇이 검증됐는지</Link>
            </div>
          </FsCard>
        </>
      ) : null}
    </>
  );
}
