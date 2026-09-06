"use client";

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
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const requestDelete = async (caseId: string) => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/finshield/cases/${caseId}/delete`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(body?.error ?? "삭제를 시작하지 못했습니다");
        return;
      }
      setRows((prev) => (prev ?? []).map((row) =>
        row.id === caseId ? { ...row, deletion_status: "PENDING", deleted_at: new Date().toISOString() } : row));
      setNotice("지우기를 시작했습니다. 원본이 실제로 사라진 것을 확인한 뒤에 완료로 기록됩니다.");
    } finally { setBusy(false); setAsking(null); }
  };

  if (!ready) return null;
  if (!token) {
    return (
      <>
        <FsCard>
          <h2 className="fs-h2">지금 이 브라우저</h2>
          <p className="fs-body mt-2">로그인하지 않은 상태입니다. 이 브라우저에 남아 있는 자료가 없습니다.</p>
        </FsCard>
        <FsLoginCard onToken={setToken} title="내 자료 관리" />
      </>
    );
  }

  return (
    <>
      <FsCard>
        <h2 className="fs-h2">지금 이 브라우저</h2>
        <p className="fs-body mt-2">
          로그인 상태입니다. 접속 표는 이 탭에만 있고 탭을 닫으면 사라집니다. 지금 바로 끊으실 수도 있습니다.
        </p>
        <button type="button" onClick={() => setToken(null)} className="fs-btn fs-btn--quiet mt-4">
          이 브라우저에서 로그아웃
        </button>
      </FsCard>

      <FsCard>
        <h2 className="fs-h2">남아 있는 검증 기록</h2>
        {notice ? <p className="fs-body mt-2">{notice}</p> : null}
        {rows === null ? (
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
                      이미 지우기가 시작됐습니다. 원본과 중간 산출물과 검색용 벡터를 지운 뒤 완료로 기록됩니다.
                    </p>
                  ) : asking === row.id ? (
                    <div className="mt-3 rounded-[10px] bg-[var(--fs-canvas)] px-4 py-3">
                      <p className="fs-body">
                        이 기록을 지우면 확인 결과와 Evidence Passport 도 함께 사라집니다. 되돌릴 수 없습니다.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button type="button" disabled={busy} onClick={() => void requestDelete(row.id)}
                          className="fs-btn fs-btn--primary !min-h-0 !px-3 !py-1.5 !text-[0.9rem]">
                          지우기 시작
                        </button>
                        <button type="button" onClick={() => setAsking(null)}
                          className="fs-btn fs-btn--quiet !min-h-0 !px-3 !py-1.5 !text-[0.9rem]">
                          그만두기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link href={`/cases/${row.id}`}
                        className="fs-btn fs-btn--quiet !min-h-0 !px-3 !py-1.5 !text-[0.9rem]">기록 열기</Link>
                      <button type="button" onClick={() => setAsking(row.id)}
                        className="fs-btn fs-btn--quiet !min-h-0 !px-3 !py-1.5 !text-[0.9rem]">
                        이 기록 지우기
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </FsCard>
    </>
  );
}
