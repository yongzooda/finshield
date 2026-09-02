/**
 * N-203 IP 레이트 리밋 — **휘발 메모리에서만.**
 *
 * ## 왜 DB에 두지 않나
 *
 * 명세가 금지한다: 「IP 카운터는 엣지 미들웨어 휘발 메모리에서만 처리(최대
 * 24시간 후 자동 소멸), **DB·서버 로그 저장 금지**」. IP는 준식별자라 DB에
 * 쌓는 순간 DR-30x의 비식별 원칙 경계를 넘는다. 그래서 원본 IP를 들고 있지도
 * 않는다 — **해시만** 센다.
 *
 * ## ⚠️ 이 방어는 완전하지 않다. 그것이 설계다
 *
 * Vercel은 함수·인스턴스가 여러 개라 메모리 카운터는 **인스턴스마다 따로 센다**
 * (세션에서 실측으로 겪었다). 즉 한 IP가 여러 인스턴스에 흩어지면 상한을 넘길 수
 * 있다. 그럼에도 이 층을 두는 이유는 명세가 방어를 **겹겹이** 설계했기 때문이다:
 *
 *     세션 내(N-201·202) → **IP 단위(N-203)** → 전역 하드 쿼터(N-204)
 *
 * IP 층은 흔한 연타를 막는 과속방지턱이고, 마지막 방어선은 전역 쿼터다.
 * 완전한 IP 차단을 원하면 공유 저장소가 필요한데, 그건 금지돼 있다.
 * **못 막는 경우가 있다는 것을 알고 두는 층이다.**
 */

import "server-only";
import { createHash } from "node:crypto";
import { env } from "../env";
import { jsonNoStore } from "./http";

export type LimitKind = "REQUEST" | "SESSION" | "JUDGMENT";

type Bucket = { count: number; resetAt: number };

/** 종류별 창(window)과 상한. 값의 정본은 `env`이지만 창 길이는 명세 고정값이다 */
const WINDOW_MS: Record<LimitKind, number> = {
  REQUEST: 60_000, // 분당
  SESSION: 60 * 60_000, // 시간당
  JUDGMENT: 24 * 60 * 60_000, // 일
};

const buckets = new Map<string, Bucket>();

/** 24시간이 지나면 흔적이 남지 않는다 (명세 요구) */
const MAX_AGE_MS = 24 * 60 * 60_000;

function sweep(now: number): void {
  for (const [k, b] of buckets) {
    if (b.resetAt + MAX_AGE_MS < now) buckets.delete(k);
  }
}

/**
 * IP를 해시한다 — **원본을 메모리에도 두지 않는다.**
 * 프로세스마다 다른 소금을 쓰므로 재시작하면 같은 IP도 다른 키가 된다.
 */
const SALT = createHash("sha256").update(String(process.hrtime.bigint())).digest("hex");

export function clientKey(ip: string | null): string {
  return createHash("sha256").update(SALT + (ip ?? "unknown")).digest("hex").slice(0, 24);
}

/** Vercel이 붙이는 헤더에서 이용자 IP를 뽑는다. 저장하지 않고 즉시 해시한다 */
export function clientKeyFromHeaders(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]?.trim() : h.get("x-real-ip");
  return clientKey(ip || null);
}

export type LimitResult =
  | { ok: true }
  /** EX-405 — 차단 시간을 **반드시** 알린다. 정상 이용자가 오차단될 수 있다 */
  | { ok: false; retryAfterSec: number };

export function consume(key: string, kind: LimitKind, limit: number): LimitResult {
  const now = Date.now();
  sweep(now);

  const id = `${kind}:${key}`;
  const b = buckets.get(id);

  if (!b || b.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + WINDOW_MS[kind] });
    return { ok: true };
  }

  if (b.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }

  b.count += 1;
  return { ok: true };
}

/** 사람이 읽는 대기 안내 — 「잠시」가 아니라 **얼마나**를 말한다 (EX-405) */
export function waitMessage(retryAfterSec: number): string {
  if (retryAfterSec < 60) return `요청이 많아 잠시 기다려 주세요. 약 ${retryAfterSec}초 후에 다시 시도하실 수 있습니다.`;
  const min = Math.ceil(retryAfterSec / 60);
  if (min < 60) return `요청이 많아 잠시 기다려 주세요. 약 ${min}분 후에 다시 시도하실 수 있습니다.`;
  const hour = Math.ceil(min / 60);
  return `오늘 이용하실 수 있는 횟수를 다 쓰셨습니다. 약 ${hour}시간 후에 다시 시도하실 수 있습니다.`;
}

/** 테스트용 — 창을 넘기지 않고 상태를 지운다 */
export function _reset(): void {
  buckets.clear();
}

// ─────────────────────────────────────── 라우트에서 쓰는 관문

const LIMIT: Record<LimitKind, () => number> = {
  REQUEST: () => env.RATE_LIMIT_PER_MINUTE,
  SESSION: () => env.RATE_LIMIT_SESSIONS_PER_HOUR,
  JUDGMENT: () => env.RATE_LIMIT_JUDGMENTS_PER_DAY,
};

/**
 * 상한을 소진하고, 넘었으면 **바로 돌려줄 응답**을 만든다.
 * 통과면 null이다 — 호출부는 `if (blocked) return blocked;` 한 줄로 쓴다.
 *
 * ⚠️ **명세는 「엣지 미들웨어」라고 적었지만 라우트 핸들러에 뒀다.**
 * ① Edge 런타임은 `node:crypto`·`server-only`를 쓸 수 없다
 * ② Edge는 Node 함수보다 인스턴스가 더 많아 메모리 카운터가 **더** 흩어진다
 * 카운터를 일하는 함수와 같은 프로세스에 두는 편이 그나마 정확하다.
 * 「휘발 메모리에서만·DB 저장 금지」라는 실질 요구는 그대로 지킨다.
 */
export function gate(req: Request, kind: LimitKind): Response | null {
  const key = clientKeyFromHeaders(req.headers);
  const r = consume(key, kind, LIMIT[kind]());
  if (r.ok) return null;

  return jsonNoStore(
    { ok: false, error: "RATE_LIMITED", message: waitMessage(r.retryAfterSec) },
    429,
  );
}
