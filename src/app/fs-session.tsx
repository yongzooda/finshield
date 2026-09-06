"use client";

/**
 * 브라우저 세션.
 *
 * access token 은 탭이 닫히면 사라지는 자리에만 둔다. 서버는 세션을 저장하지
 * 않는다. 화면을 옮길 때마다 다시 로그인하지 않아도 되게 하려는 최소한의 장치다.
 *
 * 이 값으로 남의 자료에 닿을 수는 없다. 소유권은 데이터베이스 정책이 정한다.
 *
 * `sessionStorage` 는 React 바깥에 있는 값이다. effect 로 읽어 state 에 옮기면
 * 서버 렌더 결과와 어긋나므로, 외부 저장소로 두고 구독한다. 서버에는 이 값이
 * 없으니 서버 snapshot 은 언제나 `null` 이다.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import { FsCard } from "./fs-shell";

const KEY = "finshield_token";

const listeners = new Set<() => void>();
let cached: string | null = null;
let cacheFilled = false;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const readToken = (): string | null => {
  if (cacheFilled) return cached;
  try {
    cached = sessionStorage.getItem(KEY);
  } catch {
    // 저장을 막아 둔 브라우저에서는 매번 로그인한다.
    cached = null;
  }
  cacheFilled = true;
  return cached;
};

// 서버와 hydration 시점에는 아직 저장소를 읽을 수 없다. 그 사이에 로그인 화면을
// 잘못 띄우지 않도록 `ready` 로 구분한다.
const noToken = (): string | null => null;
const onClient = (): boolean => true;
const onServer = (): boolean => false;

const writeToken = (value: string | null): void => {
  cached = value;
  cacheFilled = true;
  try {
    if (value === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, value);
  } catch {
    // 저장에 실패해도 이 탭에서는 계속 쓴다.
  }
  for (const listener of [...listeners]) listener();
};

export function useFsToken(): [string | null, (value: string | null) => void, boolean] {
  const token = useSyncExternalStore(subscribe, readToken, noToken);
  const ready = useSyncExternalStore(subscribe, onClient, onServer);
  const update = useCallback((value: string | null) => { writeToken(value); }, []);
  return [token, update, ready];
}

export function FsLoginCard({ onToken, title = "로그인" }: {
  onToken: (token: string) => void; title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/finshield/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await response.json();
      if (!response.ok) { setNotice(body.error ?? "로그인에 실패했습니다"); return; }
      onToken(body.access_token as string);
    } finally { setBusy(false); }
  };

  return (
    <FsCard className="mt-8">
      <h2 className="fs-h2">{title}</h2>
      <p className="fs-body mt-2">검증 기록은 본인만 볼 수 있어 로그인이 필요합니다.</p>
      {notice ? <p className="fs-body mt-2">{notice}</p> : null}
      <form className="mt-5 max-w-sm" onSubmit={submit}>
        <label className="fs-label" htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" required autoComplete="username" className="fs-field" />
        <label className="fs-label mt-4" htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="fs-field" />
        <button type="submit" disabled={busy} className="fs-btn fs-btn--primary mt-5">
          {busy ? "확인하는 중" : "로그인"}
        </button>
      </form>
    </FsCard>
  );
}
