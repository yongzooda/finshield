"use client";

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

type Notification = {
  id: string; case_id: string; notification_type: string; title: string;
  body_masked: string; read_at: string | null; created_at: string;
};

export function NotificationCenter() {
  const [token, setToken, ready] = useFsToken();
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    let alive = true;
    void (async () => {
      const response = await fetch("/api/finshield/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => null);
      if (!alive) return;
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(body?.error ?? "알림을 읽지 못했습니다");
        return;
      }
      setRows((body?.notifications ?? []) as Notification[]);
    })();
    return () => { alive = false; };
  }, [ready, token, setToken]);

  const markRead = async (id: string) => {
    if (!token) return;
    const response = await fetch("/api/finshield/notifications", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: id }),
    });
    if (!response.ok) { setNotice("읽음으로 바꾸지 못했습니다"); return; }
    setRows((prev) => (prev ?? []).map((row) =>
      row.id === id ? { ...row, read_at: new Date().toISOString() } : row));
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="알림" />;

  return (
    <>
      <header>
        <p className="fs-eyebrow">알림</p>
        <h1 className="fs-h1 mt-2">다시 확인한 결과를 여기 남깁니다</h1>
        <p className="fs-lead mt-3">
          달라진 것이 없을 때도 남깁니다. 조용한 것과 확인하지 않은 것은 다르기 때문입니다.
        </p>
      </header>

      {notice ? <FsCard className="mt-8"><p className="fs-body">{notice}</p></FsCard> : null}

      {rows === null ? (
        <FsCard className="mt-8"><p className="fs-body">불러오는 중입니다.</p></FsCard>
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
                  <Link href={`/cases/${row.case_id}`} className="fs-btn fs-btn--quiet !min-h-0 !px-3 !py-1.5 !text-[0.9rem]">
                    기록 열기
                  </Link>
                  {row.read_at ? null : (
                    <button type="button" onClick={() => void markRead(row.id)}
                      className="fs-btn fs-btn--quiet !min-h-0 !px-3 !py-1.5 !text-[0.9rem]">
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
