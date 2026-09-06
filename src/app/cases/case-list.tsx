"use client";

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
  title_masked: string; created_at: string;
};

export function CaseList() {
  const [token, setToken, ready] = useFsToken();
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;
    let alive = true;
    void (async () => {
      const result = await fetchCases<{ cases: CaseRow[] }>(token);
      if (!alive) return;
      if (result.ok) { setRows(result.data.cases); setNotice(null); return; }
      if (result.status === 401) setToken(null);
      setNotice(result.error);
    })();
    return () => { alive = false; };
  }, [ready, token, setToken]);

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="내 기록 보기" />;

  if (rows === null) {
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
        <p className="fs-body mt-2">거래 전 검증을 한 번 해 보시면 여기에 남습니다.</p>
        <Link href="/verify" className="fs-btn fs-btn--primary mt-4">거래 전에 확인하기</Link>
      </FsCard>
    );
  }

  return (
    <FsCard className="mt-8">
      <ul className="space-y-4">
        {rows.map((row) => {
          const state = LIFECYCLE_LABEL[row.lifecycle] ?? { label: row.lifecycle, tone: "neutral" as const };
          return (
            <li key={row.id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
              <Link href={`/cases/${row.id}`}
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
    </FsCard>
  );
}
