"use client";

const KEY = "finshield_token";
// 새 탭이 같은 세션을 이어받도록 세션 식별자만 브라우저 전체 저장소에 둔다. Token은 두지 않는다.
const HINT = "finshield_session_hint";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const listeners = new Set<() => void>();
let cached: string | null = null;
let filled = false;
let generation = 0;
let refreshing: Promise<string> | null = null;
let restoring: Promise<void> | null = null;
let restoreState: "unknown" | "pending" | "settled" = "unknown";
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
/** 화면 상태 격리에만 사용한다. 서버 소유자 인증은 대체하지 않는다. */
export const sessionOwner = (token: string | null): string | null => claims(token)?.sub ?? null;

export const sessionIdentity = (token: string | null): string | null => claims(token)?.session_id ?? token;

export function readSessionToken(): string | null {
  if (!filled) {
    try { cached = sessionStorage.getItem(KEY); } catch { cached = null; }
    filled = true;
  }
  return cached;
}

function notify() {
  for (const listener of [...listeners]) listener();
}

function publish(value: string | null) {
  cached = value; filled = true;
  try { if (value) sessionStorage.setItem(KEY, value); else sessionStorage.removeItem(KEY); } catch { /* 이 탭의 메모리로 계속한다. */ }
  notify();
}

function readHint(): string | null {
  try {
    const value = localStorage.getItem(HINT);
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}

/** 지울 때는 그 세션의 표시일 때만 지운다. 다른 탭이 새로 로그인한 표시는 남긴다. */
function writeHint(value: string | null, session?: string): void {
  try {
    if (value) localStorage.setItem(HINT, value);
    else if (!session || localStorage.getItem(HINT) === session) localStorage.removeItem(HINT);
  } catch { /* 새 탭에서 다시 로그인해야 할 뿐이다. */ }
}

/** 로그인·만료·로그아웃에만 사용한다. 늦게 도착한 이전 갱신 응답을 무효화한다. */
export function writeSessionToken(value: string | null): void {
  const previous = claims(readSessionToken());
  generation++; suspended = false; refreshing = null;
  publish(value);
  const next = claims(value);
  if (next && UUID.test(next.session_id)) writeHint(next.session_id);
  if (!value && previous) {
    writeHint(null, previous.session_id);
    channel?.postMessage({ kind: "SIGNED_OUT", session: previous.session_id });
  }
}

/**
 * 이 탭에 Token이 없고 이어받을 세션 표시가 있으면 확인이 끝날 때까지 false다.
 * 그동안 화면은 로그인 카드를 먼저 보이지 않는다.
 */
export function sessionSettled(): boolean {
  if (readSessionToken() || restoreState === "settled") return true;
  return restoreState === "unknown" ? readHint() === null : false;
}

/**
 * 새 탭: 세션 식별자로 그 세션의 HttpOnly Refresh Cookie 갱신을 요청해 Access를 받는다.
 * 같은 세션의 다른 탭 갱신과 같은 잠금을 쓰므로 회전된 Cookie를 순서대로 사용한다.
 */
function restore(initial: boolean): void {
  if (restoring || readSessionToken()) return;
  const hint = readHint();
  if (!hint) {
    if (restoreState !== "settled") { restoreState = "settled"; notify(); }
    return;
  }
  const epoch = generation;
  // 확인하는 동안 보호 화면이 비어 있으므로 기다리는 시간을 짧게 둔다.
  if (initial) restoreState = "pending";
  const task = exclusive(hint, async () => {
    if (generation !== epoch || readSessionToken()) return;
    const response = await fetch("/api/finshield/session", { method: "PATCH", credentials: "same-origin",
      headers: { "X-FinShield-Session": hint }, signal: AbortSignal.timeout(8_000), cache: "no-store", redirect: "error" });
    const body = await response.json().catch(() => null);
    if (generation !== epoch || readSessionToken()) return;
    const next = claims(body?.access_token);
    if (response.ok && next?.session_id === hint) { suspended = false; publish(body.access_token); }
    else if (response.status === 401) writeHint(null, hint);
  }).catch(() => { /* 연결 실패는 로그인 화면으로 두고 다음 확인 때 다시 시도한다. */ }).finally(() => {
    if (restoring === task) restoring = null;
    if (restoreState !== "settled") { restoreState = "settled"; notify(); }
  });
  restoring = task;
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
  if (document.visibilityState === "hidden") return;
  const token = readSessionToken();
  // 다른 탭에서 로그인했다면 이 탭도 그 세션을 이어받는다. 첫 확인이 끝난 뒤에만 시도한다.
  if (!token) { if (restoreState === "settled") restore(false); return; }
  if (!suspended) void freshSessionToken(token).catch(() => { /* 실패한 갱신은 사용자 요청 때 다시 확인한다. */ });
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("finshield-session-status");
      channel.onmessage = event => {
        if (event.data?.kind === "SIGNED_OUT" && event.data.session === claims(readSessionToken())?.session_id) {
          generation++; suspended = false; refreshing = null; publish(null); writeHint(null, event.data.session);
        }
      };
    }
    timer = setInterval(maintain, 30_000);
    document.addEventListener("visibilitychange", maintain);
    restore(true);
    queueMicrotask(maintain);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); document.removeEventListener("visibilitychange", maintain); channel?.close(); channel = undefined; }
  };
}
