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
import { readRunStream } from "../run-stream";
import { FsCard, FsChip } from "../fs-shell";
import { AGENT_LABEL } from "../fs-labels";
import { DemoResultView, type DemoResult } from "./demo-result";

type Claim = { claim_ref: string; statement_masked: string; materiality: string };
type AgentLine = { agentCode: string; status: string; toolCalls?: number };

export function DemoRunner() {
  const [step, setStep] = useState<"idle" | "running" | "done">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [seedText, setSeedText] = useState<string | null>(null);
  const [seedClaims, setSeedClaims] = useState<Claim[]>([]);
  const [agents, setAgents] = useState<AgentLine[]>([]);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [limited, setLimited] = useState(false);

  // 상한에 걸린 방문자에게 가장 최근의 실제 실행 기록을 따로 보여 준다. 새 실행이 아니다.
  const showRecent = async () => {
    setNotice(null);
    const response = await fetch("/api/finshield/demo/recent").catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body) {
      setNotice(body?.error ?? "최근 실행 결과를 불러오지 못했습니다. 잠시 뒤에 다시 시도해 주세요.");
      return;
    }
    setSeedText(null); setSeedClaims([]); setResult(body as DemoResult); setStep("done");
  };

  const start = async () => {
    setNotice(null); setLimited(false); setAgents([]); setResult(null); setStep("running");
    try {
      const response = await fetch("/api/finshield/demo", { method: "POST" });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setNotice(body?.error ?? "실행하지 못했습니다");
        setLimited(body?.code === "DEMO_LIMIT_REACHED");
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
            setResult(event as DemoResult);
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

  return (
    <>
      <header>
        <p className="fs-eyebrow">서비스 체험</p>
        <h1 className="fs-h1 mt-2">대출 권유, 어떻게 확인할까요?</h1>
        <p className="fs-lead mt-3">준비된 가상 문자로 검증 과정과 공식 근거를 확인해 보세요. 회원가입은 필요하지 않습니다.</p>
      </header>

      {notice ? (
        <FsCard>
          <p role="alert" className="fs-body">{notice}</p>
          {limited ? (
            <button type="button" onClick={() => void showRecent()} className="fs-btn fs-btn--quiet mt-3">
              가장 최근 실행 결과 보기
            </button>
          ) : null}
        </FsCard>
      ) : null}

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
            시작하면 공식 자료를 조회해 항목별 결과를 만듭니다. 한 네트워크에서 한 시간에 여섯 번까지 실행할 수 있습니다.
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

      {step === "done" && result ? <DemoResultView result={result} /> : null}
    </>
  );
}
