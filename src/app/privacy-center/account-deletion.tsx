"use client";
import { useEffect, useState } from "react";
import { FsCard } from "../fs-shell";
import { FsLoginCard } from "../fs-session";
import { sessionFetch, sessionIdentity, readSessionToken } from "../session-client";

/** AUTH-005·S-017: 본인 확인 뒤 사용자가 최종 확인한다. 재로그인이 탈퇴를 실행하지 않는다. */
export function AccountDeletion({ token, setToken }: { token: string | null; setToken: (token: string | null) => void }) {
  const identity = sessionIdentity(token);
  const [status, setStatus] = useState("NONE");
  const [asking, setAsking] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const current = readSessionToken();
        const response = current
          ? await sessionFetch("/api/finshield/account/delete", current)
          : await fetch("/api/finshield/account/delete", { cache: "no-store" });
        const body = await response.json();
        if (!alive || sessionIdentity(readSessionToken()) !== identity) return;
        if (!response.ok) { setNotice("탈퇴 상태를 확인하지 못했습니다. 다시 확인하겠습니다."); return; }
        setStatus(body.status); setNotice(null);
        if (body.status === "COMPLETED" && current) setToken(null);
      } catch { if (alive) setNotice("연결이 끊겼습니다. 삭제 상태를 다시 확인하겠습니다."); }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [identity, setToken]);
  const remove = async () => {
    setBusy(true); setNotice(null);
    try {
      let response = token ? await sessionFetch("/api/finshield/account/delete", token, { method: "POST" })
        : await fetch("/api/finshield/account/delete", { method: "POST" });
      let body = await response.json();
      if (sessionIdentity(readSessionToken()) !== identity) return;
      if (response.ok && body.dispatch_required) {
        // 첫 응답의 HttpOnly 영수증 저장 후 같은 확인의 실행 예약을 이어 간다.
        response = token ? await sessionFetch("/api/finshield/account/delete", token, { method: "POST" })
          : await fetch("/api/finshield/account/delete", { method: "POST" });
        body = await response.json();
      }
      if (sessionIdentity(readSessionToken()) !== identity) return;
      if (body.status) { setStatus(body.status); setAsking(false); }
      if (body.code === "REAUTHENTICATION_REQUIRED") { setReauth(true); setAsking(false); }
      if (!response.ok) setNotice(body.error ?? "탈퇴 접수를 확인하지 못했습니다");
      if (body.status === "COMPLETED") setToken(null);
    } catch { setNotice("응답을 받지 못했습니다. 상태를 확인한 뒤 같은 요청을 이어서 처리해 주세요."); }
    finally { setBusy(false); }
  };
  if (!token && status === "NONE") return null;
  const pending = status !== "NONE" && status !== "COMPLETED";
  return <FsCard>
    <h2 className="fs-h2">전체 계정 탈퇴</h2>
    <p className="fs-body mt-2">탈퇴를 시작하면 새 작업과 기록 접근을 차단합니다. 모든 Case와 첨부 자료를 정리한 뒤 계정을 마지막에 삭제합니다.</p>
    <div role="status" aria-live="polite">
      {status === "COMPLETED" ? <p className="fs-body mt-3">자료 정리와 계정 삭제를 확인했습니다.</p> : null}
      {pending ? <p className="fs-body mt-3">삭제를 처리 중입니다. 화면을 닫아도 계속 진행하며, 실제 삭제를 확인한 뒤 완료로 표시합니다.</p> : null}
      {notice ? <p className="fs-body mt-3">{notice}</p> : null}
    </div>
    {reauth ? <FsLoginCard title="탈퇴 전에 비밀번호로 다시 로그인" onToken={next => { setToken(next); setReauth(false); setAsking(true); }} /> : null}
    {asking ? <div className="mt-4">
      <p className="fs-body">모든 검증 기록, Passport, 가입 후 점검과 계정을 삭제합니다. 되돌릴 수 없습니다. 계속하시겠습니까?</p>
      <button type="button" className="fs-btn fs-btn--primary mt-3" disabled={busy} onClick={() => void remove()}>전체 자료 삭제와 탈퇴 시작</button>
      <button type="button" className="fs-btn fs-btn--quiet mt-3" disabled={busy} onClick={() => setAsking(false)}>그만두기</button>
    </div> : status === "NONE" && !reauth ? <button type="button" className="fs-btn fs-btn--quiet mt-4" onClick={() => setAsking(true)}>계정 탈퇴 확인</button> : null}
    {pending ? <button type="button" className="fs-btn fs-btn--quiet mt-4" disabled={busy} onClick={() => void remove()}>{busy ? "요청 확인 중" : "중단된 삭제 이어서 처리"}</button> : null}
  </FsCard>;
}
