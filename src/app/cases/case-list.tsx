"use client";

/**
 * 내 Case 목록 (S-005).
 *
 * 상태 축을 하나로 합치지 않는다. Case 수명 주기와 검증 실행 상태는 다른 축이라
 * 한 칸에 섞어 적으면 무엇이 끝났는지 알 수 없다 (CASE-002).
 */

import { useState } from "react";
import Link from "next/link";
import { FsCard, FsChip, type ChipTone } from "../fs-shell";

type CaseRow = {
  id: string; scenario: string; lifecycle: string;
  title_masked: string; created_at: string;
};

const LIFECYCLE: Record<string, { label: string; tone: ChipTone }> = {
  DRAFT: { label: "작성 중", tone: "neutral" },
  INPUT_REVIEW: { label: "입력 검토", tone: "neutral" },
  VERIFYING: { label: "확인 중", tone: "caution" },
  VERIFIED: { label: "확인 완료", tone: "verified" },
  NEED_MORE_INFORMATION: { label: "정보 부족", tone: "caution" },
  STOPPED_BY_USER: { label: "중단함", tone: "neutral" },
  CLOSED: { label: "종료", tone: "neutral" },
};

const SCENARIO: Record<string, string> = { LOAN: "대출", SAVINGS: "예적금", INVESTMENT: "투자" };

export function CaseList() {
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice(null);
    try {
      const session = await fetch("/api/finshield/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await session.json();
      if (!session.ok) { setNotice(body.error ?? "로그인에 실패했습니다"); return; }
      const listed = await fetch("/api/finshield/cases", {
        headers: { Authorization: `Bearer ${body.access_token}` },
      });
      const list = await listed.json();
      if (!listed.ok) { setNotice(list.error ?? "목록을 읽지 못했습니다"); return; }
      setRows(list.cases as CaseRow[]);
    } finally { setBusy(false); }
  };

  if (rows === null) {
    return (
      <FsCard className="mt-8">
        <h2 className="fs-h2">로그인</h2>
        {notice ? <p className="fs-body mt-2">{notice}</p> : null}
        <form className="mt-5 max-w-sm" onSubmit={load}>
          <label className="fs-label" htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" required autoComplete="username" className="fs-field" />
          <label className="fs-label mt-4" htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="fs-field" />
          <button type="submit" disabled={busy} className="fs-btn fs-btn--primary mt-5">
            {busy ? "불러오는 중" : "내 기록 보기"}
          </button>
        </form>
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
          const state = LIFECYCLE[row.lifecycle] ?? { label: row.lifecycle, tone: "neutral" as const };
          return (
            <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
              <div>
                <p className="font-bold">{row.title_masked}</p>
                <p className="fs-meta mt-1">
                  {SCENARIO[row.scenario] ?? row.scenario} · {new Date(row.created_at).toLocaleString("ko-KR")}
                </p>
              </div>
              <FsChip tone={state.tone}>{state.label}</FsChip>
            </li>
          );
        })}
      </ul>
    </FsCard>
  );
}
