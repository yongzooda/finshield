"use client";

import { readSessionToken, sessionIdentity } from "../session-client";

/**
 * 내 Case 목록 (S-005).
 *
 * 상태 축을 하나로 합치지 않는다. Case 수명 주기와 검증 실행 상태는 다른 축이라
 * 한 칸에 섞어 적으면 무엇이 끝났는지 알 수 없다 (CASE-002).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../fs-shell";
import { FsLoginCard, useFsToken } from "../fs-session";
import { fetchCases } from "./case-api";
import { LIFECYCLE_LABEL, SCENARIO_LABEL } from "../fs-labels";

type CaseRow = {
  id: string; scenario: string; lifecycle: string;
  title_masked: string; created_at: string; latest_passport_id?: string | null;
};

export function CaseList({ intent = "history" }: { intent?: "history" | "aftercare" }) {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [loadedSession, setLoadedSession] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      } else { setNotice(result.error); if (result.status === 401) setToken(null); }
    } finally { setLoadingMore(false); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title={intent === "aftercare" ? "가입 후 보호 시작하기" : "내 기록 보기"} />;

  if (rows === null || loadedSession !== sessionKey) {
    return (
      <FsCard className="mt-8">
        <p className="fs-body">{notice ?? "불러오는 중입니다."}</p>
      </FsCard>
    );
  }

  if (rows.length === 0) {
    return (
      <FsCard className="mt-8">
        <h2 className="fs-h2">아직 기록이 없습니다</h2>
        <p className="fs-body mt-2">대출 권유를 먼저 확인해 주세요. 같은 기록에서 가입 후 점검까지 이어집니다.</p>
        <Link href="/verify" className="fs-btn fs-btn--primary mt-4">거래 전에 확인하기</Link>
      </FsCard>
    );
  }

  return (
    <FsCard className="mt-8">
      <h2 className="fs-h2 mb-2">{intent === "aftercare" ? "점검할 거래를 선택하세요" : "최근 검증 기록"}</h2>
      <ul className="space-y-4">
        {rows.map((row) => {
          const state = LIFECYCLE_LABEL[row.lifecycle] ?? { label: row.lifecycle, tone: "neutral" as const };
          // 가입 후 점검은 확정된 검증 결과와 비교한다. 결과가 없는 기록은 점검 화면에서 막히므로
          // 기록 화면으로 보내고 그 사실을 먼저 알린다.
          const verified = Boolean(row.latest_passport_id);
          return (
            <li key={row.id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
              {intent === "aftercare" && !verified ? (
                <p className="fs-meta mb-1">검증을 마치지 않은 기록입니다. 검증을 끝낸 뒤 가입 후 점검을 할 수 있습니다.</p>
              ) : null}
              <Link href={intent === "aftercare" && verified ? `/cases/${row.id}/journey` : `/cases/${row.id}`}
                className="-mx-3 flex flex-wrap items-baseline justify-between gap-3 rounded-[10px] px-3 py-2 no-underline hover:bg-[var(--fs-canvas)]">
                <span>
                  <span className="block font-bold">{row.title_masked}</span>
                  <span className="fs-meta mt-1 block">
                    {SCENARIO_LABEL[row.scenario] ?? row.scenario} · {new Date(row.created_at).toLocaleString("ko-KR")}
                  </span>
                </span>
                <FsChip tone={state.tone}>{state.label}</FsChip>
              </Link>
            </li>
          );
        })}
      </ul>
      {notice ? <p role="status" className="fs-body mt-4">{notice}</p> : null}
      {cursor ? <button type="button" className="fs-btn fs-btn--quiet mt-4" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "이전 기록을 불러오는 중" : "이전 기록 더 보기"}</button> : null}
    </FsCard>
  );
}
