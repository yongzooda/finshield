"use client";

/**
 * 거래 전 검증 흐름.
 *
 * 단계는 화면 하나에 이어 붙인다. 명세의 S-006·S-008·S-009·S-010 을 논리 단위로
 * 지키되 사용자가 여러 화면을 오가지 않게 한다.
 *
 * 진행 표시에 백분율을 쓰지 않는다 (S-009). 실제로 어느 Agent 가 시작하고
 * 끝났는지만 보여 준다. 결과에는 0~100 점수를 만들지 않는다 (RES-002).
 */

import { useRef, useState } from "react";

type Claim = {
  claim_id: string; claim_ref: string; claim_type: string;
  statement_masked: string; materiality: string;
};
type Evidence = {
  ref: string; title: string; source: string; grade: string; official_id: string | null;
  url: string | null; published_at: string | null; freshness: string; directness: string;
  reference_only: boolean; excerpt: string;
};
type ClaimResult = {
  claim_ref: string; state: string; evidence_refs: string[];
  withheld_reason: string | null; rationale_masked: string;
};
type AgentLine = { agentCode: string; status: string; findings?: number; toolCalls?: number };

const STATE_LABEL: Record<string, string> = {
  VERIFIED: "확인됨",
  CONTRADICTED: "사실과 다름",
  CONFLICT: "공식 자료가 엇갈림",
  UNKNOWN: "근거를 찾지 못함",
  NEED_MORE_INFORMATION: "정보가 더 필요함",
  WITHHELD: "판단 보류",
};

const AGENT_LABEL: Record<string, string> = {
  PRODUCT_INSTITUTION: "상품·기관",
  FRAUD_CHANNEL: "사칭·경로",
  SALES_CONDUCT: "설명·권유",
  REGULATION_DISPUTE: "법령·분쟁",
};

export function VerifyFlow() {
  const [step, setStep] = useState<"login" | "input" | "claims" | "running" | "result">("login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [agents, setAgents] = useState<AgentLine[]>([]);
  const [claimResults, setClaimResults] = useState<ClaimResult[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [partial, setPartial] = useState(false);
  const token = useRef<string | null>(null);

  const authed = (extra: Record<string, string> = {}) => ({
    "Content-Type": "application/json",
    ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}),
    ...extra,
  });

  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/finshield/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await response.json();
      if (!response.ok) { setNotice(body.error ?? "로그인에 실패했습니다"); return; }
      token.current = body.access_token;
      setStep("input");
    } finally { setBusy(false); }
  };

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
      sessionStorage.setItem("finshield_case", body.case_id);
      sessionStorage.setItem("finshield_masked", body.masked_text ?? "");
      setStep("claims");
    } finally { setBusy(false); }
  };

  const startRun = async () => {
    setBusy(true); setNotice(null); setAgents([]);
    setStep("running");
    try {
      const response = await fetch("/api/finshield/verify", {
        method: "POST", headers: authed(),
        body: JSON.stringify({
          case_id: sessionStorage.getItem("finshield_case"),
          journey_stage: "PRE_TRANSACTION",
          masked_text: sessionStorage.getItem("finshield_masked") ?? "",
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
            setAgents((prev) => [...prev, { agentCode: event.agentCode, status: "RUNNING" }]);
          } else if (event.type === "agent_finished") {
            setAgents((prev) => prev.map((line2) => line2.agentCode === event.agentCode
              ? { ...line2, status: event.status, findings: event.findings, toolCalls: event.toolCalls }
              : line2));
          } else if (event.type === "done") {
            setClaimResults(event.claim_results);
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

  const card = "rounded-xl border border-slate-200 bg-white p-5";

  return (
    <section className="mt-8">
      {notice ? (
        <p className="mb-5 rounded-lg bg-slate-100 px-4 py-3 text-[0.95rem] leading-relaxed text-slate-800">
          {notice}
        </p>
      ) : null}

      {step === "login" ? (
        <form className={card} onSubmit={login}>
          <h2 className="text-[1.15rem] font-bold text-navy">로그인</h2>
          <p className="mt-2 text-[0.95rem] text-slate-600">검증 기록은 본인만 볼 수 있어서 로그인이 필요합니다.</p>
          <label className="mt-4 block text-[0.9rem] font-semibold text-slate-700" htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" required autoComplete="username"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          <label className="mt-3 block text-[0.9rem] font-semibold text-slate-700" htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          <button type="submit" disabled={busy}
            className="mt-4 rounded-lg bg-navy px-4 py-2 font-bold text-white disabled:opacity-50">
            {busy ? "확인하는 중" : "로그인"}
          </button>
        </form>
      ) : null}

      {step === "input" ? (
        <div className={card}>
          <h2 className="text-[1.15rem] font-bold text-navy">권유받은 내용</h2>
          <label className="sr-only" htmlFor="statement">권유받은 내용</label>
          <textarea id="statement" rows={8} value={text} onChange={(event) => setText(event.target.value)}
            placeholder="문자나 통화로 들은 내용을 그대로 붙여 넣어 주세요."
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 leading-relaxed" />
          <button type="button" disabled={busy || text.trim().length === 0} onClick={submitText}
            className="mt-3 rounded-lg bg-navy px-4 py-2 font-bold text-white disabled:opacity-50">
            {busy ? "정리하는 중" : "확인할 항목 만들기"}
          </button>
        </div>
      ) : null}

      {step === "claims" ? (
        <div className={card}>
          <h2 className="text-[1.15rem] font-bold text-navy">무엇을 확인할까요</h2>
          <p className="mt-2 text-[0.95rem] text-slate-600">
            고르신 항목만 확인합니다. 사실이 아닌 항목은 빼 주세요.
          </p>
          <ul className="mt-4 space-y-2">
            {claims.map((claim) => (
              <li key={claim.claim_id}>
                <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={picked.has(claim.claim_id)}
                    onChange={(event) => setPicked((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.add(claim.claim_id); else next.delete(claim.claim_id);
                      return next;
                    })} />
                  <span>
                    <span className="block leading-relaxed text-slate-900">{claim.statement_masked}</span>
                    <span className="mt-1 block text-[0.85rem] text-slate-500">
                      {claim.materiality === "MATERIAL" ? "거래에 영향이 큰 항목" : "참고 항목"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy || picked.size === 0} onClick={startRun}
            className="mt-4 rounded-lg bg-navy px-4 py-2 font-bold text-white disabled:opacity-50">
            확인 시작
          </button>
        </div>
      ) : null}

      {step === "running" ? (
        <div className={card} aria-live="polite">
          <h2 className="text-[1.15rem] font-bold text-navy">확인하는 중</h2>
          <ul className="mt-4 space-y-2">
            {agents.map((agent) => (
              <li key={agent.agentCode} className="flex items-center justify-between text-[0.95rem]">
                <span className="text-slate-800">{AGENT_LABEL[agent.agentCode] ?? agent.agentCode}</span>
                <span className="text-slate-500">
                  {agent.status === "RUNNING" ? "확인 중"
                    : `${agent.status === "SUCCEEDED" ? "완료" : "일부만 확인"} · 도구 ${agent.toolCalls ?? 0}회`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === "result" ? (
        <div className="space-y-5">
          {partial ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-[0.95rem] leading-relaxed text-amber-900">
              일부 항목은 끝까지 확인하지 못했습니다. 아래에서 확인한 범위와 못 한 범위를 함께 보실 수 있습니다.
            </p>
          ) : null}
          <div className={card}>
            <h2 className="text-[1.15rem] font-bold text-navy">확인 결과</h2>
            <ul className="mt-4 space-y-4">
              {claimResults.map((result) => {
                const claim = claims.find((item) => item.claim_ref === result.claim_ref);
                return (
                  <li key={result.claim_ref} className="border-t border-slate-100 pt-4 first:border-0 first:pt-0">
                    <p className="leading-relaxed text-slate-900">{claim?.statement_masked ?? result.claim_ref}</p>
                    <p className="mt-1 font-bold text-navy">{STATE_LABEL[result.state] ?? result.state}</p>
                    <p className="mt-1 text-[0.95rem] leading-relaxed text-slate-700">{result.rationale_masked}</p>
                    {result.withheld_reason ? (
                      <p className="mt-1 text-[0.9rem] text-slate-500">{result.withheld_reason}</p>
                    ) : null}
                    {result.evidence_refs.length > 0 ? (
                      <p className="mt-1 text-[0.9rem] text-slate-500">
                        근거 {result.evidence_refs.join(", ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={card}>
            <h2 className="text-[1.15rem] font-bold text-navy">확인에 쓴 근거</h2>
            <ul className="mt-4 space-y-3">
              {evidence.map((item) => (
                <li key={item.ref} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                  <p className="text-[0.9rem] text-slate-500">{item.ref} · {item.source} · 등급 {item.grade}</p>
                  <p className="mt-1 font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-[0.95rem] leading-relaxed text-slate-700">{item.excerpt}</p>
                  <p className="mt-1 text-[0.85rem] text-slate-500">
                    {item.official_id ?? "식별자 없음"} · {item.published_at ?? "발행일 불명"} ·{" "}
                    {item.freshness === "FRESH" ? "현행" : item.freshness === "STALE" ? "오래됨" : "현행 여부 불명"}
                    {item.reference_only ? " · 참고용" : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
