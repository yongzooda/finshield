"use client";

/**
 * 재검증 비교 (S-014).
 *
 * 지난 결과를 고치지 않는다. 같은 항목을 오늘의 자료로 다시 보고 새 판을 쌓은
 * 뒤, 지난 판과 무엇이 달라졌는지만 보여 준다. 달라진 것이 없으면 없다고
 * 적는다. 그것도 결과다.
 *
 * 진행은 실제 단계만 보여 준다. 백분율을 만들지 않는다 (S-009).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../../../fs-shell";
import { FsLoginCard, useFsToken } from "../../../fs-session";
import { AGENT_LABEL, AXIS_LABEL, CLAIM_STATE_LABEL, axisResultOf, overallResultOf } from "../../../fs-labels";

type AgentLine = { agentCode: string; status: string; toolCalls?: number };
type Diff = {
  material_change: boolean;
  claim_changes: { claim_id: string; before: string | null; after: string | null; is_material: boolean }[];
  evidence_changes: { independence_key: string; change: string }[];
  result_changes: { field: string; before: string; after: string }[];
};
type Done = {
  job_status: string | null; passport_id: string | null; partial: boolean;
  diff: Diff | null; claims: { claim_id: string; statement_masked: string }[];
};

export function RevalidateFlow({ caseId }: { caseId: string }) {
  const [token, setToken, ready] = useFsToken();
  const [step, setStep] = useState<"idle" | "running" | "done">("idle");
  const [agents, setAgents] = useState<AgentLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [requestKey, setRequestKey] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/finshield/cases/${caseId}/revalidate`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const body = await response.json();
        if (!active) return;
        if (!response.ok) {
          if (response.status === 401) setToken(null);
          throw new Error(body.error ?? "처리 상태를 읽지 못했습니다");
        }
        const job = body.job;
        if (!job) return;
        setJobId(job.job_id);
        const lines: AgentLine[] = [];
        for (const record of job.events ?? []) {
          const event = record.payload;
          if (event.type === "agent_started") lines.push({ agentCode: event.agentCode, status: "RUNNING" });
          if (event.type === "agent_finished") {
            const line = lines.find((entry) => entry.agentCode === event.agentCode);
            if (line) { line.status = event.status; line.toolCalls = event.toolCalls; }
          }
        }
        setAgents(lines);
        setQueued(job.job_status === "QUEUED");
        if (["QUEUED", "RUNNING"].includes(job.job_status)) {
          setStep("running"); timer = setTimeout(() => void poll(), 2000);
        } else if (["CHANGED", "NO_CHANGE"].includes(job.job_status)) {
          setDone(job); setStep("done"); setRequestKey(null);
        } else {
          setStep("idle"); setRequestKey(null);
          setNotice(job.reason_code === "USER_CANCELLED" ? "재검증을 중단했습니다. 이전 결과는 보관됩니다."
            : "재검증을 완료하지 못했습니다. 이전 결과는 보관됩니다.");
        }
      } catch (error) {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : "처리 상태를 읽지 못했습니다");
        timer = setTimeout(() => void poll(), 5000);
      }
    };
    void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [token, caseId, setToken, refresh]);

  const start = async () => {
    if (!token) return;
    const key = requestKey ?? crypto.randomUUID();
    setRequestKey(key); setNotice(null); setAgents([]); setStep("running");
    try {
      const response = await fetch(`/api/finshield/cases/${caseId}/revalidate`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key },
      });
      const body = await response.json();
      if (body.job_id) setJobId(body.job_id);
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(body.error ?? "다시 확인하지 못했습니다");
        setStep(body.job_id ? "running" : "idle");
      }
    } catch { setNotice("접수 상태를 확인 중입니다. 연결되면 저장된 진행 상태를 표시합니다."); }
    setRefresh((value) => value + 1);
  };

  const cancel = async () => {
    if (!token || !jobId) return;
    try {
      const response = await fetch(`/api/finshield/cases/${caseId}/revalidate?job_id=${jobId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("취소 요청을 전달하지 못했습니다");
      setNotice("중단 요청을 전달했습니다. 진행 중인 처리를 정리하고 있습니다.");
      setRefresh((value) => value + 1);
    } catch { setNotice("취소 요청을 전달하지 못했습니다. 다시 시도해 주세요."); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="다시 확인하기" />;

  const diff = done?.diff ?? null;
  const statementOf = (claimId: string) =>
    done?.claims.find((claim) => claim.claim_id === claimId)?.statement_masked ?? claimId;

  return (
    <>
      <header>
        <p className="fs-eyebrow">다시 확인하기</p>
        <h1 className="fs-h1 mt-2">이전 결과와 비교하기</h1>
        <p className="fs-lead mt-3">
          같은 항목을 다시 검증하고 결과와 근거의 변화를 비교합니다. 이전 기록은 그대로 보관됩니다.
        </p>
        <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet mt-4">기록으로 돌아가기</Link>
      </header>

      {notice ? <FsCard className="mt-8"><p className="fs-body" role="alert">{notice}</p></FsCard> : null}

      {step === "idle" ? (
        <FsCard className="mt-8">
          <h2 className="fs-h2">지금 다시 확인할까요</h2>
          <p className="fs-body mt-2">
            확인에는 시간이 걸립니다. 창을 닫아도 처리는 계속되며, 다시 열면 진행 상태와 달라진 점을 확인할 수 있습니다.
          </p>
          <button type="button" onClick={() => void start()} className="fs-btn fs-btn--primary mt-4">
            다시 확인 시작
          </button>
        </FsCard>
      ) : null}

      {step === "running" ? (
        <FsCard className="mt-8">
          <h2 className="fs-h2">다시 확인하는 중</h2>
          <p className="fs-body mt-2">이 화면을 닫아도 처리는 계속됩니다.</p>
          <div className="mt-4 flex gap-3">
            <button type="button" className="fs-btn fs-btn--quiet" onClick={() => void cancel()}>재검증 중단</button>
            {queued ? <button type="button" className="fs-btn fs-btn--quiet" onClick={() => void start()}>처리 연결 재시도</button> : null}
          </div>
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

      {step === "done" && done ? (
        <>
          <FsCard className="mt-8">
            <FsChip tone={!diff || done.partial ? "neutral" : diff.material_change ? "contra" : "verified"}>
              {!diff ? "비교 결과 없음" : done.partial ? "일부만 확인" : diff.material_change ? "중요한 변화 있음" : "중요한 변화 없음"}
            </FsChip>
            <h2 className="fs-h2 mt-3">
              {!diff ? "비교 결과를 받지 못했습니다" : diff.material_change
                ? "이전 결과에서 중요한 변화가 확인됐습니다"
                : "이전 결과에서 중요한 변화는 없었습니다"}
            </h2>
            <p className="fs-body mt-2">
              {!diff ? "기록에서 실행 상태를 확인해 주세요." : diff.material_change
                ? "아래에서 무엇이 어떻게 바뀌었는지 보시고, 필요하면 공식 창구로 확인하세요."
                : "확인한 범위 안에서 중요한 변화가 없었습니다. 확인하지 못한 항목까지 안전하다는 뜻은 아닙니다."}
            </p>
            {done.partial ? (
              <p className="fs-meta mt-2">이번 확인도 끝까지 가지 못한 단계가 있습니다.</p>
            ) : null}
          </FsCard>

          <FsCard>
            <h2 className="fs-h2">무엇이 달라졌나</h2>
            {!diff ? <p className="fs-body mt-2">비교할 결과가 없습니다.</p> : (diff.claim_changes.length === 0 && diff.result_changes.length === 0
              && diff.evidence_changes.length === 0) ? (
              <p className="fs-body mt-2">항목 상태, 축별 결과, 인용한 출처가 모두 그대로입니다.</p>
            ) : (
              <div className="mt-4 space-y-5">
                {diff.result_changes.length > 0 ? (
                  <div>
                    <p className="font-bold">전체·축별 결과</p>
                    <ul className="fs-body mt-2 list-disc space-y-1 pl-5">
                      {diff.result_changes.map((row) => {
                        const axis = row.field.startsWith("axis:") ? row.field.slice(5) : null;
                        const label = row.field === "overall_result" ? "종합 결과" : AXIS_LABEL[axis ?? ""] ?? row.field;
                        const value = row.field === "overall_result" ? overallResultOf : axisResultOf;
                        return <li key={row.field}>{label}: {value(row.before).label} → {value(row.after).label}</li>;
                      })}
                    </ul>
                  </div>
                ) : null}
                {diff.claim_changes.length > 0 ? (
                  <div>
                    <p className="font-bold">항목별 상태</p>
                    <ul className="mt-2 space-y-2">
                      {diff.claim_changes.map((row) => (
                        <li key={row.claim_id} className="fs-body">
                          <span className="block">{statementOf(row.claim_id)}</span>
                          <span className="fs-meta">
                            {CLAIM_STATE_LABEL[row.before ?? ""] ?? row.before ?? "없음"}
                            {" → "}
                            {CLAIM_STATE_LABEL[row.after ?? ""] ?? row.after ?? "없음"}
                            {row.is_material ? " · 거래에 영향이 큰 항목" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {diff.evidence_changes.length > 0 ? (
                  <div>
                    <p className="font-bold">인용한 출처</p>
                    <ul className="fs-meta mt-2 list-disc space-y-1 pl-5">
                      {diff.evidence_changes.map((row) => (
                        <li key={row.independence_key}>
                          <span>{row.change === "ADDED" ? "새로 인용한 출처" : "이번에는 인용하지 않은 출처"}</span>
                          <details className="mt-1"><summary>출처 식별 정보</summary><span className="break-all">{row.independence_key}</span></details>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--primary">기록에서 새 판 보기</Link>
              <Link href={`/cases/${caseId}/passport`} className="fs-btn fs-btn--quiet">검증 근거 기록</Link>
            </div>
          </FsCard>
        </>
      ) : null}
    </>
  );
}
