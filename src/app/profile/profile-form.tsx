"use client";

import { sessionFetch, readSessionToken, sessionIdentity } from "../session-client";

/**
 * 금융 프로필 온보딩·설정 (S-004).
 *
 * 금액을 묻지 않는다. 구간만 받는다. 항목마다 왜 묻는지를 옆에 적는다
 * (AUTH-006). 전부 건너뛰어도 검증은 그대로 진행되고, 적합성 축만 판단을
 * 미룬다 (AUTH-007).
 *
 * 여기서 고친 값은 다음 검증부터 적용된다. 이미 나온 Passport 는 그때의
 * Snapshot 을 그대로 들고 있어 바뀌지 않는다 (AUTH-008).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FsCard, FsChip } from "../fs-shell";
import { FsLoginCard, useFsToken } from "../fs-session";
import { fetchProfile } from "../cases/case-api";
import {
  EMPTY_PROFILE, PROFILE_FIELDS, completenessOf, type ProfileKey, type ProfileValues,
} from "@/lib/finshield/profile";

const COMPLETENESS: Record<string, string> = {
  SKIPPED: "건너뜀", PARTIAL: "일부 답함", COMPLETE: "모두 답함",
};

export function ProfileForm() {
  const [token, setToken, ready] = useFsToken();
  const sessionKey = sessionIdentity(token);
  const [values, setValues] = useState<ProfileValues>({ ...EMPTY_PROFILE });
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = readSessionToken();
    if (!ready || !token || sessionIdentity(token) !== sessionKey) return;
    let alive = true;
    void (async () => {
      const response = await fetchProfile<{ profile: (ProfileValues & { updated_at?: string }) | null }>(token);
      if (!alive) return;
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        setNotice(response.error);
        return;
      }
      const row = response.data.profile;
      if (row) {
        const next = { ...EMPTY_PROFILE };
        for (const field of PROFILE_FIELDS) {
          const value = row[field.key];
          if (typeof value === "string") next[field.key] = value;
        }
        setValues(next);
        setSaved(row.updated_at ?? null);
      }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [ready, sessionKey, setToken]);

  const save = async (next: ProfileValues) => {
    if (!token) return;
    setBusy(true); setNotice(null);
    try {
      const response = await sessionFetch("/api/finshield/profile", token, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setToken(null);
        // S-COM-007: 저장하지 못했으면 저장한 것처럼 보여 주지 않는다.
        setNotice(body?.error ?? "저장하지 못했습니다");
        return;
      }
      setValues(next);
      setSaved((body?.profile?.updated_at as string | undefined) ?? new Date().toISOString());
    } catch {
      setNotice("연결이 끊어졌습니다. 처리 결과를 확인한 뒤 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };

  if (!ready) return null;
  if (!token) return <FsLoginCard onToken={setToken} title="금융 프로필" />;

  const completeness = completenessOf(values);

  return (
    <>
      <header>
        <p className="fs-eyebrow">금융 프로필</p>
        <h1 className="fs-h1 mt-2">금융 프로필</h1>
        <p className="fs-lead mt-3">
          원하는 항목만 선택하세요. 시험용 가상 정보만 입력할 수 있으며, 모든 항목을 건너뛸 수 있습니다.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <FsChip tone={completeness === "COMPLETE" ? "verified" : "neutral"}>
            {COMPLETENESS[completeness] ?? completeness}
          </FsChip>
          {saved ? (
            <span className="fs-meta">마지막 저장 {new Date(saved).toLocaleString("ko-KR")}</span>
          ) : (
            <span className="fs-meta">아직 저장한 적이 없습니다</span>
          )}
        </div>
      </header>

      {notice ? <FsCard className="mt-8"><p className="fs-body">{notice}</p></FsCard> : null}

      <FsCard className="mt-8">
        {!loaded ? (
          <p className="fs-body">{notice ? "프로필을 불러오지 못했습니다. 다시 열어 주세요." : "불러오는 중입니다."}</p>
        ) : (
          <>
            <ul className="space-y-7">
              {PROFILE_FIELDS.map((field) => (
                <li key={field.key}>
                  <p className="font-bold">{field.label}</p>
                  <p className="fs-meta mt-1">{field.why}</p>
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={field.label}>
                    {field.options.map((option) => {
                      const picked = values[field.key as ProfileKey] === option.value;
                      return (
                        <button key={option.value} type="button" aria-pressed={picked}
                          onClick={() => setValues((prev) => ({ ...prev, [field.key]: option.value }))}
                          className={`fs-btn !px-3 !text-[0.92rem] ${
                            picked ? "fs-btn--primary" : "fs-btn--quiet"}`}>
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" disabled={busy} onClick={() => void save(values)}
                className="fs-btn fs-btn--primary">
                {busy ? "저장하는 중" : "저장하기"}
              </button>
              <button type="button" disabled={busy} onClick={() => void save({ ...EMPTY_PROFILE })}
                className="fs-btn fs-btn--quiet">전부 건너뛰기</button>
              <Link href="/verify" className="fs-btn fs-btn--quiet">거래 전에 확인하기</Link>
            </div>
          </>
        )}
      </FsCard>

      <FsCard>
        <h2 className="fs-h2">프로필 이용 안내</h2>
        <ul className="fs-body mt-3 list-disc space-y-2 pl-5">
          <li>새 검증에는 당시의 프로필이 기록됩니다. 이후 프로필을 바꿔도 과거 기록은 유지됩니다.</li>
          <li>현재 적합성의 세부 판단은 완료되지 않았습니다. 프로필을 입력해도 적합 판정을 제공하지 않습니다.</li>
          <li>전부 건너뛰면 적합성 축은 &ldquo;정보 부족&rdquo;으로 남습니다. 안전하다는 뜻이 아니라 판단하지 않았다는 뜻입니다.</li>
        </ul>
      </FsCard>
    </>
  );
}
