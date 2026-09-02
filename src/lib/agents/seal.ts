/**
 * 세션 봉인 — **상태를 서버에 두지 않고 봉인해서 이용자가 들고 다니게 한다.**
 *
 * ## 왜 이렇게 바꿨나 (2026.08.16 실측)
 *
 * 세션을 서버 메모리 Map에 두는 구조는 **Vercel에서 동작하지 않는다.** 라우트마다
 * 별도 서버리스 함수로 배포되어 **메모리를 공유하지 않기 때문이다.** 실측:
 * `/api/consult`는 같은 세션을 계속 알아보는데(200 → 410 → 200) `/api/judge`만
 * 410을 냈다. 로컬 `next dev`는 단일 프로세스라 이 결함이 드러나지 않는다.
 *
 * ## 왜 DB에 넣지 않나
 *
 * 절대 규칙 3(DR-4xx)이 진술·슬롯·판단·실행 로그의 **서버·DB·로그 저장을
 * 금지**한다. Redis·KV도 서버 저장이라 같은 규칙에 걸린다. 그래서 저장하는 대신
 * **AES-256-GCM으로 봉인해 클라이언트에 돌려준다** — 서버에는 아무것도 남지 않고,
 * 클라이언트는 열어볼 수 없다.
 *
 * ## 키
 *
 * 이미 있는 서버 전용 비밀 두 개에서 HKDF로 파생한다. 환경변수를 새로 요구하면
 * 배포가 그 값을 넣기 전까지 죽는데(env.ts는 기본값을 두지 않는다), 그 대가를 치를
 * 만큼의 이득이 없다. 비밀이 교체되면 진행 중이던 세션이 만료될 뿐이고, 세션은
 * 원래 휘발성이라 문제가 되지 않는다.
 */

import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../env";
import type { Slots } from "../types";
import type { RefinedFacts } from "./types";
import type { TraceEntry } from "./trace";

/** 봉인되는 내용. **이 형태가 곧 세션의 전부**다 */
export type SessionSnapshot = {
  /** 형식 버전 — 구조가 바뀌면 옛 토큰을 조용히 오해하지 않고 만료로 처리한다 */
  v: 1;
  createdAt: number;
  lastSeenAt: number;
  slots: Partial<Slots>;
  facts: RefinedFacts | null;
  /**
   * ① 상담 계층만 쓰는 값. 봉인 안에 있지만 `Session` 객체로는 올라가지 않는다 —
   * 계층 격리(SR-402)는 여전히 「판단 계층이 닿을 수 없다」로 유지된다.
   */
  maskedStatement: string | null;
  askedInCycle: number;
  askedTotal: number;
  /** ToolBudget 카운터 (F-607) — 봉인 안에 있어 클라이언트가 되돌릴 수 없다 */
  toolCycle: number;
  toolSession: number;
  sensitiveConsent: boolean;
  /** 실행 로그 (F-402) — 상담 구간에서 쌓인 것 */
  trace: TraceEntry[];
  /**
   * 유보 이어가기 (F-308 확장 · R-07 ①) — 직전 판단이 유보였을 때 «무엇이
   * 확인되면 판단 가능한지»의 자료 목록. **결론·확신도·판단 이유는 싣지
   * 않는다** — ① 상담이 판단 결과를 보지 못한다는 격리(권한 매트릭스)를
   * 지키는 경계다. 이 목록은 이미 화면으로 이용자에게 안내된 문장들이며,
   * 재진입 상담이 어떤 자료 이야기를 듣게 될지 아는 용도로만 쓰인다.
   * 옛 토큰에는 이 필드가 없다 — undefined는 null과 같이 읽는다.
   */
  reentryNeeded?: string[] | null;
};

const KEY = hkdfSync(
  "sha256",
  // 서버 전용 비밀. 클라이언트 번들에 들어가지 않는다(env.ts가 server-only다)
  Buffer.from(env.DATABASE_URL + env.ANTHROPIC_API_KEY),
  Buffer.from("precase-session-seal"),
  Buffer.from("v1"),
  32,
);

const IV_BYTES = 12;

export function seal(snapshot: SessionSnapshot): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(snapshot), "utf8"),
    cipher.final(),
  ]);
  // iv | tag | 본문 — 한 덩어리를 base64url로. 헤더·본문 어디에도 평문이 없다
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export type UnsealResult =
  | { ok: true; snapshot: SessionSnapshot }
  /** 만료 — 유휴 시간 초과 (N-401). 이용자에게는 설계 동작으로 설명한다 */
  | { ok: false; reason: "EXPIRED" }
  /** 위조·손상·버전 불일치. 이용자에게는 만료와 같게 보인다 */
  | { ok: false; reason: "INVALID" };

export function unseal(token: string): UnsealResult {
  let snapshot: SessionSnapshot;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= IV_BYTES + 16) return { ok: false, reason: "INVALID" };

    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(KEY), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + 16));
    const json = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + 16)),
      decipher.final(),
    ]).toString("utf8");
    snapshot = JSON.parse(json) as SessionSnapshot;
  } catch {
    // 인증 태그 불일치 = 위조. 어떤 이유인지 응답에 싣지 않는다
    return { ok: false, reason: "INVALID" };
  }

  if (snapshot.v !== 1) return { ok: false, reason: "INVALID" };

  // 유휴 만료를 **봉인 안의 시각**으로 판정한다. 클라이언트가 고칠 수 없다
  if (Date.now() - snapshot.lastSeenAt > env.SESSION_IDLE_MINUTES * 60_000) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, snapshot };
}

export function freshSnapshot(): SessionSnapshot {
  const now = Date.now();
  return {
    v: 1,
    createdAt: now,
    lastSeenAt: now,
    slots: {},
    facts: null,
    maskedStatement: null,
    askedInCycle: 0,
    askedTotal: 0,
    toolCycle: 0,
    toolSession: 0,
    sensitiveConsent: false,
    trace: [],
    reentryNeeded: null,
  };
}
