/**
 * 세션 — **서버에 저장하지 않는다.** 봉인된 토큰으로 오간다 (`seal.ts`).
 *
 * 진술·슬롯·판단·실행 로그는 서버 어디에도 저장되지 않는다. DB에 이 데이터의
 * 테이블이 있으면 그 자체가 설계 위반이고(데이터 명세 7장), 이 모듈이 `db`를
 * import하지 않는 것이 코드 차원의 보장이다.
 *
 * ⚠️ **2026.08.16 — 프로세스 메모리 Map에서 봉인 토큰으로 바꿨다.**
 * Vercel은 라우트마다 별도 함수로 배포해 **메모리를 공유하지 않는다.** 실측에서
 * `/api/consult`는 세션을 계속 알아보는데 `/api/judge`만 410을 냈다. 로컬
 * `next dev`는 단일 프로세스라 이 결함이 드러나지 않아, 로컬 통과를 근거로
 * 「세션이 유지된다」고 판단했던 것이 틀렸다.
 *
 * 유휴 30분이 지나면 만료다 (N-401 · EX-407). 만료 판정은 **봉인 안의 시각**으로
 * 하므로 클라이언트가 되돌릴 수 없다. 만료된 세션에 접근하면 「사라졌다」가 아니라
 * **왜 사라졌는지**를 알려줘야 한다 — 개인정보를 저장하지 않기 때문이라는 설명이
 * 서비스 신뢰의 일부다 (화면 4.3).
 */

import { env } from "../env";
import { freshSnapshot, seal, unseal, type SessionSnapshot } from "./seal";
import { ToolBudget } from "../tools/budget";
import { Trace } from "./trace";
import type { Slots } from "../types";
import type { Evidence, JudgmentOutcome, RefinedFacts } from "./types";

export type Session = {
  createdAt: number;
  lastSeenAt: number;
  slots: Partial<Slots>;
  facts: RefinedFacts | null;
  evidence: Evidence | null;
  outcome: JudgmentOutcome | null;
  /** 이번 사이클 되묻기 횟수 */
  askedInCycle: number;
  /** 되돌림 포함 누적 되묻기 횟수 (N-202 총 상한) */
  askedTotal: number;
  budget: ToolBudget;
  trace: Trace;
  /** 민감정보 별도 동의 여부 (F-602). 세션 한정이며 이력은 보존하지 않는다 (N-503) */
  sensitiveConsent: boolean;
  /**
   * 유보 이어가기 (F-308 확장) — 직전 유보의 «필요 자료» 목록. 판단 파이프라인이
   * 채우고, 재진입 상담이 읽는다. 결론·확신도는 여기 없다 (seal.ts 주석).
   */
  reentryNeeded: string[] | null;
};

/** 봉인 스냅샷 → 살아 있는 세션 객체 */
function hydrate(snap: SessionSnapshot): Session {
  return {
    createdAt: snap.createdAt,
    lastSeenAt: snap.lastSeenAt,
    slots: snap.slots,
    facts: snap.facts,
    evidence: null,
    outcome: null,
    askedInCycle: snap.askedInCycle,
    askedTotal: snap.askedTotal,
    budget: ToolBudget.restore(snap.toolCycle, snap.toolSession),
    trace: Trace.restore(snap.trace),
    sensitiveConsent: snap.sensitiveConsent,
    reentryNeeded: snap.reentryNeeded ?? null,
  };
}

/**
 * 세션 객체 → 봉인 토큰.
 *
 * ⚠️ `maskedStatement`를 **인자로 따로 받는다.** `Session`에 그 필드를 두면
 * 판단 계층이 세션을 통째로 받는 순간 원문에 손이 닿는다(SR-402). 봉인 안에는
 * 들어가되 세션 객체에는 올라오지 않는 형태를 유지한다.
 */
export function sealSession(s: Session, maskedStatement: string | null): string {
  const b = s.budget.snapshot();
  return seal({
    v: 1,
    createdAt: s.createdAt,
    lastSeenAt: Date.now(),
    slots: s.slots,
    facts: s.facts,
    maskedStatement,
    askedInCycle: s.askedInCycle,
    askedTotal: s.askedTotal,
    toolCycle: b.cycle,
    toolSession: b.session,
    sensitiveConsent: s.sensitiveConsent,
    trace: [...s.trace.read()],
    reentryNeeded: s.reentryNeeded,
  });
}

/** 새 세션. 서버에 등록하지 않는다 — 봉인해서 돌려줄 뿐이다 */
export function createSession(): Session {
  return hydrate(freshSnapshot());
}

export type SessionLookup =
  | { ok: true; session: Session; maskedStatement: string | null }
  | { ok: false; reason: "EXPIRED" | "NOT_FOUND"; message: string };

/**
 * 만료 안내 문구 — 원인에 맞게 설명한다 (화면 4.3 · EX-403·407).
 * 진술만 사라진 경우(consult route의 STATEMENT_GONE)도 같은 말로 설명하므로 내보낸다 —
 * 같은 문장을 두 벌 들고 있으면 한쪽만 고쳐진다.
 */
export const EXPIRED_MESSAGE =
  "상담 내용이 사라졌습니다. 프리케이스는 개인정보를 저장하지 않기 때문에 " +
  "일정 시간이 지나면 내용이 남지 않습니다. 처음부터 다시 진행해 주세요.";

export function openSession(token: string): SessionLookup {
  const r = unseal(token);
  if (!r.ok) {
    // 만료와 위조를 사용자에게 구분해 보일 이유가 없다. 내부적으로만 구분한다
    return {
      ok: false,
      reason: r.reason === "EXPIRED" ? "EXPIRED" : "NOT_FOUND",
      message: EXPIRED_MESSAGE,
    };
  }
  return { ok: true, session: hydrate(r.snapshot), maskedStatement: r.snapshot.maskedStatement };
}

/** 되돌림 (F-308) — 사이클을 새로 연다. 누적 카운터는 이어진다 */
export function startNewCycle(s: Session): void {
  s.askedInCycle = 0;
  s.budget.startCycle();
  s.evidence = null;
  s.outcome = null;
  s.trace.info("SYSTEM", "추가로 여쭤보기 위해 상담 단계로 돌아갑니다");
}

export type AskGate =
  | { ok: true }
  | { ok: false; scope: "CYCLE" | "TOTAL"; asked: number; limit: number };

/** 되묻기 상한 판정 (N-202: 사이클 8 · 총 10). 초과는 EX-103 → 유보 경로 */
export function tryAsk(s: Session): AskGate {
  if (s.askedTotal >= env.MAX_FOLLOWUP_TOTAL) {
    return { ok: false, scope: "TOTAL", asked: s.askedTotal, limit: env.MAX_FOLLOWUP_TOTAL };
  }
  if (s.askedInCycle >= env.MAX_FOLLOWUP_QUESTIONS) {
    return { ok: false, scope: "CYCLE", asked: s.askedInCycle, limit: env.MAX_FOLLOWUP_QUESTIONS };
  }
  s.askedInCycle += 1;
  s.askedTotal += 1;
  return { ok: true };
}

