"use client";

const KEY = "finshield_token";
const listeners = new Set<() => void>();
let cached: string | null = null;
let filled = false;
let generation = 0;
let refreshing: Promise<string> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let channel: BroadcastChannel | undefined;
let suspended = false;

function claims(token: string | null): { session_id: string; sub: string; exp: number } | null {
  try {
    if (!token || token.length > 16384) return null;
    const value = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof value.session_id === "string" && typeof value.sub === "string" && Number.isFinite(value.exp) ? value : null;
  } catch { return null; }
}

/** 갱신마다 입력 화면을 다시 불러오지 않도록 세션 자체의 식별자를 반환한다. */
export const sessionIdentity = (token: string | null): string | null => claims(token)?.session_id ?? token;

export function readSessionToken(): string | null {
  if (!filled) {
    try { cached = sessionStorage.getItem(KEY); } catch { cached = null; }
    filled = true;
  }
  return cached;
}

function publish(value: string | null) {
  cached = value; filled = true;
  try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* 이 탭의 메모리로 계속한다. */ }
  for (const listener of [...listeners]) listener();
}

/** 로그인·만료·로그아웃에만 사용한다. 늦게 도착한 이전 갱신 응답을 무효화한다. */
export function writeSessionToken(value: string | null): void {
  const previous = claims(readSessionToken());
  generation++; suspended = false; refreshing = null;
  publish(value);
  if (!value && previous) channel?.postMessage({ kind: "SIGNED_OUT", session: previous.session_id });
}

export class SessionUnavailable extends Error {
  constructor(readonly status: 401 | 409 | 503) { super(status === 401 ? "다시 로그인해 주세요" : status === 409 ? "로그인 상태가 바뀌었습니다. 다시 열어 주세요" : "세션 갱신을 확인하지 못했습니다. 다시 시도해 주세요"); }
}

async function exclusive<T>(session: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`finshield-session-${session}`, action);
  return action();
}

async function renew(token: string, epoch: number): Promise<string> {
  const old = claims(token);
  if (!old) throw new SessionUnavailable(401);
  return exclusive(old.session_id, async () => {
    if (generation !== epoch) throw new SessionUnavailable(409);
    const response = await fetch("/api/finshield/session", { method: "PATCH", credentials: "same-origin",
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (generation !== epoch) throw new SessionUnavailable(409);
    const body = await response.json().catch(() => null);
    if (generation !== epoch) throw new SessionUnavailable(409);
    if (response.status === 401) { writeSessionToken(null); throw new SessionUnavailable(401); }
    const next = claims(body?.access_token);
    if (!response.ok || !next || next.session_id !== old.session_id || next.sub !== old.sub) throw new SessionUnavailable(503);
    publish(body.access_token); suspended = false;
    return body.access_token;
  });
}

/** 오래된 세션으로 쓰기를 먼저 보내거나 실패한 쓰기를 자동 재전송하지 않는다. */
export async function freshSessionToken(provided: string): Promise<string> {
  const current = readSessionToken();
  const original = claims(provided); const active = claims(current);
  if (current !== provided && (!original || !active || original.session_id !== active.session_id || original.sub !== active.sub)) throw new SessionUnavailable(409);
  const token = current ?? provided;
  const data = claims(token);
  // 파싱은 권한 검사가 아니다. 알 수 없는 기존 Token은 서버가 거부하도록 보낸다.
  if (!data || data.exp * 1000 > Date.now() + 240_000) return token;
  if (refreshing) return refreshing;
  const epoch = generation;
  const task = renew(token, epoch).catch(error => {
    if (generation === epoch) suspended = true;
    throw error instanceof SessionUnavailable ? error : new SessionUnavailable(503);
  }).finally(() => { if (refreshing === task) refreshing = null; });
  refreshing = task;
  return task;
}

export async function sessionFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  // 갱신된 Bearer가 다른 Origin 또는 비회원 API로 흘러가지 않게 경로를 제한한다.
  const target = new URL(path, "https://finshield.invalid");
  if (!path.startsWith("/api/finshield/") || target.origin !== "https://finshield.invalid" || !target.pathname.startsWith("/api/finshield/") || path.includes("\\") || target.hash) throw new Error("SESSION_PATH_REJECTED");
  try {
    const fresh = await freshSessionToken(token);
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (claims(readSessionToken())?.session_id !== claims(fresh)?.session_id || !readSessionToken()) throw new SessionUnavailable(409);
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${fresh}`);
    const response = await fetch(path, { ...init, headers, credentials: "same-origin", redirect: "error" });
    if (claims(readSessionToken())?.session_id !== claims(fresh)?.session_id || !readSessionToken()) throw new SessionUnavailable(409);
    return response;
  } catch (error) {
    if (error instanceof SessionUnavailable) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

/** 갱신과 같은 세션 잠금을 사용한다. 먼저 새로 고친 뒤 현재 세션만 폐기한다. */
export async function closeSession(token: string): Promise<Response> {
  try {
    const fresh = await freshSessionToken(token);
    const data = claims(fresh);
    return await exclusive(data?.session_id ?? "invalid", async () => {
      if (claims(readSessionToken())?.session_id !== data?.session_id || !readSessionToken()) throw new SessionUnavailable(409);
      const response = await fetch("/api/finshield/session", { method: "DELETE", credentials: "same-origin",
        headers: { Authorization: `Bearer ${fresh}` }, signal: AbortSignal.timeout(15_000), redirect: "error" });
      const body = await response.clone().json().catch(() => null);
      if (response.ok && body?.status === "SIGNED_OUT") writeSessionToken(null);
      return response;
    });
  } catch (error) {
    if (error instanceof SessionUnavailable) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

function maintain() {
  if (suspended || document.visibilityState === "hidden") return;
  const token = readSessionToken();
  if (token) void freshSessionToken(token).catch(() => { /* 실패한 갱신은 사용자 요청 때 다시 확인한다. */ });
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("finshield-session-status");
      channel.onmessage = event => {
        if (event.data?.kind === "SIGNED_OUT" && event.data.session === claims(readSessionToken())?.session_id) {
          generation++; suspended = false; refreshing = null; publish(null);
        }
      };
    }
    timer = setInterval(maintain, 30_000);
    document.addEventListener("visibilitychange", maintain);
    queueMicrotask(maintain);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); document.removeEventListener("visibilitychange", maintain); channel?.close(); channel = undefined; }
  };
}
