/**
 * F-607 도구 호출 상한 집행 (N-201 · C-8).
 *
 * 상한은 두 층이다 — **사이클당 12회 · 세션당 30회**. 값은 env에서만 읽는다.
 *
 * 초과 시 예외를 던지지 않는다. 조사 계층이 "지금까지 모은 근거로 진행"할 수
 * 있어야 하기 때문이다 (EX-204: 상한 도달은 오류가 아니라 **유보 사유**다).
 * 호출부는 `tryConsume()`의 반환값을 보고 남은 근거로 판단할지 유보할지 정한다.
 *
 * 세션 메모리에만 존재한다 (DR-4xx). DB·로그에 남기지 않는다.
 */

import { env } from "../env";

export type BudgetDenial = {
  ok: false;
  /** CYCLE = 이번 조사 사이클 소진 · SESSION = 세션 전체 소진(되돌림해도 못 늘린다) */
  scope: "CYCLE" | "SESSION";
  used: number;
  limit: number;
};

export type BudgetGrant = { ok: true; cycleUsed: number; sessionUsed: number };

export class ToolBudget {
  private cycle = 0;
  private session = 0;

  constructor(
    private readonly cycleLimit = env.MAX_TOOL_CALLS_PER_CYCLE,
    private readonly sessionLimit = env.MAX_TOOL_CALLS_PER_SESSION,
  ) {}

  /** 되돌림(F-308)으로 새 사이클을 시작할 때. 세션 카운터는 이어진다 */
  /**
   * 봉인된 카운터에서 되살린다 (seal.ts). 카운터가 요청마다 0으로 돌아가면
   * 상한(F-607)이 사실상 없는 것과 같아지므로, 이 경로가 반드시 필요하다.
   */
  static restore(cycle: number, session: number): ToolBudget {
    const b = new ToolBudget();
    b.cycle = Math.max(0, Math.trunc(cycle));
    b.session = Math.max(0, Math.trunc(session));
    return b;
  }

  startCycle(): void {
    this.cycle = 0;
  }

  tryConsume(): BudgetGrant | BudgetDenial {
    // 세션 상한을 먼저 본다 — 사이클을 새로 열어도 회복되지 않는 쪽이다
    if (this.session >= this.sessionLimit) {
      return { ok: false, scope: "SESSION", used: this.session, limit: this.sessionLimit };
    }
    if (this.cycle >= this.cycleLimit) {
      return { ok: false, scope: "CYCLE", used: this.cycle, limit: this.cycleLimit };
    }
    this.cycle += 1;
    this.session += 1;
    return { ok: true, cycleUsed: this.cycle, sessionUsed: this.session };
  }

  /** 실행 로그(F-402)·유보 안내에 쓰는 현황 */
  snapshot(): { cycle: number; cycleLimit: number; session: number; sessionLimit: number } {
    return {
      cycle: this.cycle,
      cycleLimit: this.cycleLimit,
      session: this.session,
      sessionLimit: this.sessionLimit,
    };
  }
}
