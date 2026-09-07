"use client";

import { sessionFetch, readSessionToken, sessionIdentity } from "../session-client";

/**
 * 알림센터 (S-014).
 *
 * 알림은 무슨 일이 있었는지만 알린다. 판단을 여기서 바꾸지 않는다. 자세한 것은
 * 그 Case 의 기록에서 본다.
 *
 * 달라진 것이 없다는 알림도 남긴다. 조용한 것과 확인하지 않은 것은 다르다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../fs-shell";
import { FsLoginCard, useFsToken } from "../fs-session";
import { fetchNotifications } from "../cases/case-api";

type Notification = {
  id: string; case_id: string; revalidation_job_id: string | null; passport_id: string | null; notification_type: string; title: string;
  body_masked: string; read_at: string | null; created_at: string;
};

export function NotificationCenter() {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const token = readSessionToken();
    if (!ready || !token || sessionIdentity(token) !== sessionKey) return;
    let alive = true;
    void (async () => {
      const response = await fetchNotifications<{ notifications: Notification[] }>(token);
      if (!alive || sessionIdentity(readSessionToken()) !== sessionKey) return;
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(response.error);
        return;
      }
      setRows(response.data.notifications); setLoadedSession(sessionKey); setNotice(null);
    })();
    return () => { alive = false; };
  }, [ready, sessionKey, setToken]);

  const markRead = async (id: string) => {
    if (!token) return;
    try {
    const response = await sessionFetch("/api/finshield/notifications", token, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: id }),
    });
    if (sessionIdentity(readSessionToken()) !== sessionKey) return;
    if (!response.ok) { setNotice("읽음으로 바꾸지 못했습니다"); return; }
    setRows((prev) => (prev ?? []).map((row) =>
      row.id === id ? { ...row, read_at: new Date().toISOString() } : row));
    } catch { setNotice("연결이 끊어졌습니다. 다시 시도해 주세요."); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="알림" />;

  return (
    <>
      <header>
        <p className="fs-eyebrow">알림</p>
        <h1 className="fs-h1 mt-2">알림</h1>
        <p className="fs-lead mt-3">
          재검증 결과와 기록의 변화를 확인하세요.
        </p>
      </header>

      {notice ? <FsCard className="mt-8"><p className="fs-body">{notice}</p></FsCard> : null}

      {rows === null || loadedSession !== sessionKey ? (
        notice ? null : <FsCard className="mt-8"><p className="fs-body">불러오는 중입니다.</p></FsCard>
      ) : rows.length === 0 ? (
        <FsCard className="mt-8">
          <h2 className="fs-h2">아직 알림이 없습니다</h2>
          <p className="fs-body mt-2">기록에서 다시 확인을 하시면 그 결과가 여기에 남습니다.</p>
          <Link href="/cases" className="fs-btn fs-btn--quiet mt-4">내 검증 기록</Link>
        </FsCard>
      ) : (
        <FsCard className="mt-8">
          <ul className="space-y-4">
            {rows.map((row) => (
              <li key={row.id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{row.title}</span>
                  <FsChip tone={row.notification_type === "MATERIAL_CHANGE_DETECTED" ? "contra" : "neutral"}>
                    {row.read_at ? "읽음" : "안 읽음"}
                  </FsChip>
                </div>
                <p className="fs-body mt-1">{row.body_masked}</p>
                <p className="fs-meta mt-1">{new Date(row.created_at).toLocaleString("ko-KR")}</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Link href={row.revalidation_job_id ? `/cases/${row.case_id}/revalidate?job_id=${row.revalidation_job_id}` : row.passport_id ? `/cases/${row.case_id}/passport?passport_id=${row.passport_id}` : `/cases/${row.case_id}`} className="fs-btn fs-btn--quiet !px-3 !text-[0.9rem]">
                    {row.revalidation_job_id ? "해당 재검증 비교 열기" : "해당 검증 기록 열기"}
                  </Link>
                  {row.read_at ? null : (
                    <button type="button" onClick={() => void markRead(row.id)}
                      className="fs-btn fs-btn--quiet !px-3 !text-[0.9rem]">
                      읽음으로 표시
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </FsCard>
      )}
    </>
  );
}
