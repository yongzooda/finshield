"use client";

import { AccountDeletion } from "./account-deletion";
import { closeSession, sessionFetch, readSessionToken, sessionIdentity, sessionOwner } from "../session-client";

/**
 * 개인정보 설정에서 실제로 할 수 있는 것 (S-017).
 *
 * 안내문만 두지 않는다. 이 자리에서 지금 세션을 끊고, 남아 있는 Case 를 보고,
 * 지우기를 시작할 수 있어야 한다.
 *
 * 삭제는 «지웠다» 가 아니라 «지우기 시작했다» 로 말한다. 원본이 실제로 사라진
 * 것을 확인한 뒤에야 완료로 기록되기 때문이다. 확인 전에 완료라고 적지 않는다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../fs-shell";
import { FsLoginCard, useFsToken } from "../fs-session";
import { LIFECYCLE_LABEL, SCENARIO_LABEL } from "../fs-labels";
import { fetchCases } from "../cases/case-api";

type CaseRow = {
  id: string; scenario: string; lifecycle: string; title_masked: string;
  created_at: string; deletion_status: string; deleted_at: string | null;
};

const DELETION_LABEL: Record<string, string> = {
  ACTIVE: "보관 중",
  PENDING: "지우는 중",
  PURGING: "지우는 중",
  FAILED: "지우지 못함",
};

export function PrivacyActions() {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauthCase, setReauthCase] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const signOut = async () => {
    if (!token || signingOut || busy || reauthCase) return;
    setSigningOut(true); setSessionNotice(null);
    try {
      const response = await closeSession(token);
      const body = await response.json().catch(() => null);
      if (response.ok && body?.status === "SIGNED_OUT") {
        setRows(null); setAsking(null); setReauthCase(null); setNotice(null); setToken(null);
        setSessionNotice("현재 로그인 세션을 종료했습니다.");
      } else if (response.status === 401) {
        setRows(null); setAsking(null); setReauthCase(null); setNotice(null); setToken(null);
        setSessionNotice("이 탭의 로그인 정보를 지웠습니다. 서버 세션 종료는 확인하지 못했습니다.");
      } else {
        setSessionNotice("서버 로그아웃을 확인하지 못했습니다. 다시 시도해 주세요.");
      }
    } catch {
      setSessionNotice("연결이 끊겨 로그아웃 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
    } finally { setSigningOut(false); }
  };

  useEffect(() => {
    const token = readSessionToken();
    if (!ready || !token || sessionIdentity(token) !== sessionKey) return;
    let alive = true;
    void (async () => {
      const result = await fetchCases<{ cases: CaseRow[]; next_cursor: string | null }>(token);
      if (!alive || sessionIdentity(readSessionToken()) !== sessionKey) return;
      if (result.ok) { setRows(result.data.cases); setCursor(result.data.next_cursor); setLoadedSession(sessionKey); setNotice(null); return; }
      if (result.status === 401) setToken(null);
      setNotice(result.error);
    })();
    return () => { alive = false; };
  }, [ready, sessionKey, setToken]);

  const loadMore = async () => {
    if (!token || !cursor || loadingMore || loadedSession !== sessionKey) return;
    setLoadingMore(true); setNotice(null);
    try {
      const result = await fetchCases<{ cases: CaseRow[]; next_cursor: string | null }>(token, cursor);
      if (sessionIdentity(readSessionToken()) !== sessionKey) return;
      if (result.ok) {
        setRows(previous => [...new Map([...(previous ?? []), ...result.data.cases].map(row => [row.id, row])).values()]);
        setCursor(result.data.next_cursor);
      } else setNotice(result.error);
    } finally { setLoadingMore(false); }
  };

  const requestDelete = async (caseId: string) => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const response = await sessionFetch(`/api/finshield/cases/${caseId}/delete`, token, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 403 && body?.code === "REAUTHENTICATION_REQUIRED") setReauthCase(caseId);
        if (response.status === 401) setToken(null);
        setNotice(body?.error ?? "삭제를 시작하지 못했습니다");
        return;
      }
      if (body?.status === "COMPLETED") {
        setRows(prev => (prev ?? []).filter(row => row.id !== caseId));
        setNotice("연결된 자료의 정리를 확인했고 이 검증 기록을 삭제했습니다.");
      } else {
        setRows((prev) => (prev ?? []).map((row) =>
          row.id === caseId ? { ...row, deletion_status: "PENDING", deleted_at: new Date().toISOString() } : row));
        setNotice("지우기를 시작했습니다. 원본이 실제로 사라진 것을 확인한 뒤에 완료로 기록됩니다.");
      }
    } catch {
      setNotice("연결이 끊어졌습니다. 처리 결과를 확인한 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); setAsking(null); }
  };

  if (!ready) return null;
  if (!token) {
    return (
      <>
        <FsCard>
          <h2 className="fs-h2">로그인 관리</h2>
          <p className="fs-body mt-2">현재 로그인하지 않았습니다. 기록 관리는 로그인 후 이용할 수 있습니다.</p>
          {sessionNotice ? <p role="status" className="fs-body mt-2">{sessionNotice}</p> : null}
        </FsCard>
        <FsLoginCard onToken={setToken} title="내 자료 관리" />
        <AccountDeletion key={sessionOwner(token) ?? "signed-out"} token={token} setToken={setToken} />
      </>
    );
  }

  return (
    <>
      <FsCard>
        <h2 className="fs-h2">로그인 관리</h2>
        <p className="fs-body mt-2">
          이 브라우저에서 로그인 상태를 유지하고 있습니다. 새 탭에서도 이어지며, 로그아웃하면 열린 탭 모두에서 풀립니다.
        </p>
        {sessionNotice ? <p role="status" className="fs-body mt-2">{sessionNotice}</p> : null}
        <button type="button" disabled={signingOut || busy || Boolean(reauthCase)} onClick={() => void signOut()} className="fs-btn fs-btn--quiet mt-4">
          {signingOut ? "로그아웃 확인 중" : "현재 세션 로그아웃"}
        </button>
      </FsCard>

      <AccountDeletion key={sessionOwner(token) ?? "signed-out"} token={token} setToken={setToken} />
      {reauthCase ? <FsCard>
        <h2 className="fs-h2">삭제 전에 본인 확인</h2>
        <p className="fs-body mt-2">같은 계정으로 다시 로그인하면 선택한 기록의 삭제 확인으로 돌아갑니다.</p>
        <FsLoginCard title="비밀번호로 다시 로그인" onToken={nextToken => {
          setRows(null); setToken(nextToken); setAsking(reauthCase); setReauthCase(null);
        }} />
        <button type="button" className="fs-btn fs-btn--quiet mt-3" onClick={() => setReauthCase(null)}>그만두기</button>
      </FsCard> : null}
      <FsCard>
        <h2 className="fs-h2">검증 기록 관리</h2>
        {notice ? <p className="fs-body mt-2">{notice}</p> : null}
        {rows === null || loadedSession !== sessionKey ? (
          <p className="fs-body mt-2">불러오는 중입니다.</p>
        ) : rows.length === 0 ? (
          <p className="fs-body mt-2">남아 있는 기록이 없습니다.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {rows.map((row) => {
              const state = LIFECYCLE_LABEL[row.lifecycle]
                ?? { label: row.lifecycle, tone: "neutral" as const };
              const deleting = row.deletion_status !== "ACTIVE";
              return (
                <li key={row.id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">{row.title_masked}</span>
                    <span className="flex flex-wrap gap-2">
                      <FsChip tone={state.tone}>{state.label}</FsChip>
                      <FsChip tone={deleting ? "caution" : "neutral"}>
                        {DELETION_LABEL[row.deletion_status] ?? row.deletion_status}
                      </FsChip>
                    </span>
                  </div>
                  <p className="fs-meta mt-1">
                    {SCENARIO_LABEL[row.scenario] ?? row.scenario} · {new Date(row.created_at).toLocaleString("ko-KR")}
                  </p>
                  {deleting ? (
                    <p className="fs-meta mt-2">
                      삭제를 요청한 기록입니다. 연결된 자료의 정리가 완료될 때까지 접근할 수 없습니다.
                    </p>
                  ) : asking === row.id ? (
                    <div className="mt-3 rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
                      <p className="fs-body">
                        이 기록을 지우면 확인 결과와 검증 근거 기록도 함께 사라집니다. 되돌릴 수 없습니다.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button type="button" disabled={busy || signingOut || Boolean(reauthCase)} onClick={() => void requestDelete(row.id)}
                          className="fs-btn fs-btn--primary !px-3 !text-[0.9rem]">
                          지우기 시작
                        </button>
                        <button type="button" onClick={() => setAsking(null)}
                          className="fs-btn fs-btn--quiet !px-3 !text-[0.9rem]">
                          그만두기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link href={`/cases/${row.id}`}
                        className="fs-btn fs-btn--quiet !px-3 !text-[0.9rem]">기록 열기</Link>
                      <button type="button" disabled={Boolean(reauthCase)} onClick={() => setAsking(row.id)}
                        className="fs-btn fs-btn--quiet !px-3 !text-[0.9rem]">
                        이 기록 지우기
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {cursor && loadedSession === sessionKey ? <button type="button" className="fs-btn fs-btn--quiet mt-4" disabled={loadingMore || busy} onClick={() => void loadMore()}>{loadingMore ? "이전 기록을 불러오는 중" : "이전 기록 더 보기"}</button> : null}
      </FsCard>
    </>
  );
}
