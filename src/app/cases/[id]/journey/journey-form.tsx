"use client";

/**
 * 가입·송금/피해 사실 등록 (S-015).
 *
 * 가입 여부와 피해 의심은 검증 상태와 다른 축이다. 여기서 무엇을 등록해도 이미
 * 나온 검증 결과는 바뀌지 않는다 (규칙 6).
 *
 * 피해 의심은 가입 확인 없이도 등록할 수 있다. 가입한 것으로 세지 않는다.
 */

import { useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../../../fs-shell";
import { FsLoginCard, useFsToken } from "../../../fs-session";

const CHANNELS = [
  { value: "BRANCH", label: "영업점 방문" },
  { value: "ONLINE", label: "앱·홈페이지" },
  { value: "PHONE", label: "전화" },
  { value: "AGENT", label: "모집인·상담사" },
  { value: "OTHER", label: "그 밖" },
];

const DAMAGE = [
  { value: "FUNDS_SENT", label: "돈을 보냈습니다" },
  { value: "PERSONAL_DATA_SENT", label: "신분증·계좌 정보를 보냈습니다" },
  { value: "REMOTE_CONTROL_INSTALLED", label: "원격 제어 앱을 설치했습니다" },
  { value: "OTHER", label: "그 밖의 피해가 의심됩니다" },
];

export function JourneyForm({ caseId }: { caseId: string }) {
  const [token, setToken, ready] = useFsToken();
  const [channel, setChannel] = useState("BRANCH");
  const [enrolledOn, setEnrolledOn] = useState("");
  const [terms, setTerms] = useState("");
  const [damage, setDamage] = useState("FUNDS_SENT");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<"ENROLLED" | "DAMAGE" | null>(null);

  const send = async (body: Record<string, unknown>) => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/finshield/cases/${caseId}/journey`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(result?.error ?? "등록하지 못했습니다");
        return;
      }
      if (result?.blocked) { setNotice(result.ask as string); return; }
      setDone(body.kind === "DAMAGE" ? "DAMAGE" : "ENROLLED");
    } catch {
      setNotice("연결이 끊어졌습니다. 처리 결과를 확인한 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="가입·피해 사실 등록" />;

  if (done) {
    return (
      <>
        <header>
          <p className="fs-eyebrow">등록했습니다</p>
          <h1 className="fs-h1 mt-2">
            {done === "ENROLLED" ? "가입 사실을 기록에 남겼습니다" : "피해 의심을 기록에 남겼습니다"}
          </h1>
          <p className="fs-lead mt-3">
            {done === "ENROLLED"
              ? "이어서 설명받은 내용과 계약 조건을 점검해 보세요."
              : "가입한 것으로 세지 않습니다. 지금은 자료를 모으고 공식 창구로 알리는 편이 좋습니다."}
          </p>
        </header>
        <FsCard className="mt-8">
          <div className="flex flex-wrap gap-3">
            {done === "ENROLLED" ? (
              <Link href={`/cases/${caseId}/aftercare`} className="fs-btn fs-btn--primary">가입 후 점검 시작</Link>
            ) : null}
            <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet">기록으로 돌아가기</Link>
          </div>
        </FsCard>
      </>
    );
  }

  return (
    <>
      <header>
        <p className="fs-eyebrow">가입·피해 사실 등록</p>
        <h1 className="fs-h1 mt-2">거래 이후 상황을 알려주세요</h1>
        <p className="fs-lead mt-3">
          가입 여부나 피해가 의심되는 상황을 남기고, 필요한 점검을 이어가세요.
        </p>
        <Link href={`/cases/${caseId}`} className="fs-btn fs-btn--quiet mt-4">기록으로 돌아가기</Link>
      </header>

      {notice ? <FsCard className="mt-8"><p className="fs-body">{notice}</p></FsCard> : null}

      <FsCard className="mt-8">
        <h2 className="fs-h2">가입했습니다</h2>
        <p className="fs-body mt-2">가입 사실을 남기면 같은 기록 안에서 가입 후 점검을 할 수 있습니다.</p>

        <label className="fs-label mt-5" htmlFor="channel">가입 경로</label>
        <div className="mt-2 flex flex-wrap gap-2" id="channel" role="group" aria-label="가입 경로">
          {CHANNELS.map((item) => (
            <button key={item.value} type="button" aria-pressed={channel === item.value}
              onClick={() => setChannel(item.value)}
              className={`fs-btn !px-3 !text-[0.92rem] ${
                channel === item.value ? "fs-btn--primary" : "fs-btn--quiet"}`}>
              {item.label}
            </button>
          ))}
        </div>

        <label className="fs-label mt-5" htmlFor="enrolled-on">가입일</label>
        <input id="enrolled-on" type="date" value={enrolledOn} max={new Date().toISOString().slice(0, 10)}
          onChange={(event) => setEnrolledOn(event.target.value)} className="fs-field max-w-xs" />

        <label className="fs-label mt-5" htmlFor="terms">최종 계약 조건 (선택)</label>
        <p className="fs-meta">
          시험용 가상 계약 조건을 입력해 주세요. 실제 개인정보와 계약 내용은 입력하지 마세요.
        </p>
        <textarea id="terms" rows={3} value={terms} onChange={(event) => setTerms(event.target.value)}
          className="fs-field mt-2" placeholder="예) 연 15.9% 고정, 한도 1,000만원, 36개월" />

        <button type="button" disabled={busy}
          onClick={() => void send({ kind: "ENROLLED", channel_code: channel, enrolled_on: enrolledOn || null, final_terms: terms })}
          className="fs-btn fs-btn--primary mt-5">
          {busy ? "등록하는 중" : "가입 사실 등록"}
        </button>
      </FsCard>

      <FsCard>
        <FsChip tone="caution">긴급</FsChip>
        <h2 className="fs-h2 mt-2">이미 돈을 보냈거나 피해가 의심됩니다</h2>
        <p className="fs-body mt-2">
          가입 여부와 상관없이 등록하실 수 있습니다. 가입한 것으로 세지 않습니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="무슨 일이 있었습니까">
          {DAMAGE.map((item) => (
            <button key={item.value} type="button" aria-pressed={damage === item.value}
              onClick={() => setDamage(item.value)}
              className={`fs-btn !px-3 !text-[0.92rem] ${
                damage === item.value ? "fs-btn--primary" : "fs-btn--quiet"}`}>
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy}
          onClick={() => void send({ kind: "DAMAGE", reason_code: damage })}
          className="fs-btn fs-btn--primary mt-5">
          {busy ? "등록하는 중" : "피해 의심 등록"}
        </button>
        <p className="fs-meta mt-3">
          급하시면 등록보다 먼저 거래 은행과 경찰(112)에 지급정지를 요청하세요. 등록은 그다음에 하셔도 됩니다.
        </p>
      </FsCard>
    </>
  );
}
