"use client";

/**
 * 브라우저 세션.
 *
 * Access Token은 탭 저장소, Refresh Token은 세션별 HttpOnly Cookie에 둔다.
 * 갱신은 서버를 거치고 보호 요청을 보내기 전에 만료 여유를 확인한다.
 *
 * 이 값으로 남의 자료에 닿을 수는 없다. 소유권은 데이터베이스 정책이 정한다.
 *
 * `sessionStorage` 는 React 바깥에 있는 값이다. effect 로 읽어 state 에 옮기면
 * 서버 렌더 결과와 어긋나므로, 외부 저장소로 두고 구독한다. 서버에는 이 값이
 * 없으니 서버 snapshot 은 언제나 `null` 이다.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { FsIcon } from "./fs-icon";
import { FsCard } from "./fs-shell";
import { readSessionToken, subscribeSession, writeSessionToken } from "./session-client";

export function useFsToken(): [string | null, (value: string | null) => void, boolean] {
  const token = useSyncExternalStore(subscribeSession, readSessionToken, () => null);
  const ready = useSyncExternalStore(subscribeSession, () => true, () => false);
  const update = useCallback((value: string | null) => { writeSessionToken(value); }, []);
  return [token, update, ready];
}

/**
 * 로그인·회원가입 (S-002).
 *
 * 두 가지를 한 카드에서 한다. 계정이 없는 분이 화면을 옮겨 다니지 않아도 되게
 * 하려는 것이다. 비밀번호는 서버가 보관하지 않고 발급처로 그대로 넘긴다.
 *
 * 실패해도 계정이 있는지 없는지는 알려 주지 않는다.
 */
export function FsLoginCard({ onToken, title = "로그인" }: {
  onToken: (token: string) => void; title?: string;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(
        mode === "login" ? "/api/finshield/session" : "/api/finshield/signup",
        {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setNotice(body.error ?? (mode === "login" ? "로그인에 실패했습니다" : "가입하지 못했습니다"));
        return;
      }
      if (mode === "signup" && body.needs_confirmation) {
        // 메일 확인이 켜져 있으면 token 이 오지 않는다. 그 사실을 그대로 알린다.
        setNotice("가입 확인 메일을 보냈습니다. 확인한 뒤 로그인해 주세요.");
        setMode("login");
        return;
      }
      if (typeof body.access_token !== "string" || !body.access_token) {
        setNotice("로그인 정보를 받지 못했습니다. 다시 시도해 주세요."); return;
      }
      onToken(body.access_token);
    } catch {
      setNotice("연결이 끊어졌습니다. 잠시 후 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };

  return (
    <FsCard className="fs-auth-card">
      <span className="fs-icon-tile mb-4"><FsIcon name="shield" /></span>
      <h2 className="fs-h2">{mode === "login" ? title : "회원가입"}</h2>
      <p className="fs-body mt-2">
        {mode === "login"
          ? "검증 기록은 본인만 볼 수 있어 로그인이 필요합니다."
          : "이메일로 계정을 만들고 검증 기록을 관리하세요."}
      </p>
      {notice ? <p role="alert" className="fs-inline-notice mt-3">{notice}</p> : null}
      <form className="mt-5 max-w-sm" onSubmit={submit}>
        <label className="fs-label" htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" required autoComplete="username" className="fs-field" />
        <label className="fs-label mt-4" htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" required minLength={mode === "signup" ? 10 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"} className="fs-field" />
        {mode === "signup" ? <p className="fs-meta mt-1">10자 이상으로 정해 주세요.</p> : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className="fs-btn fs-btn--primary w-full">
            {busy ? "확인하는 중" : mode === "login" ? "로그인" : "가입하기"}
          </button>
          <button type="button" disabled={busy} className="fs-body mx-auto underline"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setNotice(null); }}>
            {mode === "login" ? "계정이 없으신가요" : "이미 계정이 있으신가요"}
          </button>
        </div>
      </form>
      <div className="fs-details"><Link href="/live-demo" className="fs-text-link">먼저 로그인 없이 체험하기 <FsIcon name="arrow" /></Link></div>
    </FsCard>
  );
}
