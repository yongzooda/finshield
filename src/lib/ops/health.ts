/**
 * N-302 헬스체크 — **의존성 도달성**만 본다.
 *
 * 명세의 핵심 경로 3종은 「정적 화면 응답 · 법제처 API 도달성 · Claude API
 * 도달성」이고 데모 열람 경로를 포함한다. 이 중 뒤의 둘(+DB)이 이 모듈의 몫이고,
 * **정적 화면·데모 열람은 감시자가 `/`와 데모 URL을 직접 때려서** 확인한다
 * (D-4에서 5분 주기 감시를 붙일 때 함께 구성). 헬스체크 라우트가 자기 앱을 다시
 * fetch해서 "정적 화면이 살아 있다"고 말하는 것은 순환 확인이라 의미가 얕다.
 *
 * DB는 명세의 3종에 없지만 넣었다 — 사전 점검(S-02)·검증 결과(S-06)가 DB만으로
 * 돌아가므로, DB가 죽은 상태를 초록으로 보고하는 헬스체크는 거짓말이 된다
 * (EX-402). 축소가 아니라 추가다.
 *
 * 비용: Claude 프로브는 `models.list`라 **토큰을 쓰지 않는다**(N-204 쿼터와 무관).
 * 법제처 프로브는 목록 1건 조회다.
 */

import "server-only";
import { sql } from "../db";
import { anthropic } from "../agents/model";
import { lawSearch, LawApiError } from "../tools/law_client";
import { pgCode } from "./counters";
import { budgetState, type BudgetState } from "./budget";

export type CheckName = "db" | "law_api" | "claude_api";

export type CheckResult = {
  name: CheckName;
  ok: boolean;
  /** 소요 시간(ms) — 허용 로그 필드 중 하나 */
  ms: number;
  /**
   * 실패 사유의 **분류만**. 예외 메시지 원문을 그대로 싣지 않는다 —
   * 자격증명·URL·파라미터가 섞여 나갈 수 있고, 이 응답은 공개 엔드포인트다.
   */
  detail?: string;
};

/** ok = 전부 정상 · degraded = 일부 장애(예방 축·검증 결과는 계속 제공) · down = 전부 장애 */
export type HealthStatus = "ok" | "degraded" | "down";

export type HealthReport = {
  status: HealthStatus;
  checks: CheckResult[];
  /**
   * 오늘의 API 예산 상태 (N-204). 감시자가 이 값을 읽어 알림을 낸다 —
   * 웹훅을 설정하지 않은 배포에서는 이것이 유일한 경보 경로다 (N-303).
   */
  budget: Pick<BudgetState, "spentUsd" | "budgetUsd" | "allowed" | "warning" | "calls">;
  checkedAt: string;
};

/** 프로브 하나가 오래 매달려 헬스체크 전체를 잡아먹지 않게 한다 */
const PROBE_TIMEOUT_MS = 5_000;

async function timed(
  name: CheckName,
  run: () => Promise<unknown>,
  classify: (e: unknown) => string,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), PROBE_TIMEOUT_MS),
      ),
    ]);
    return { name, ok: true, ms: Date.now() - started };
  } catch (e) {
    const detail = e instanceof Error && e.message === "TIMEOUT" ? "TIMEOUT" : classify(e);
    return { name, ok: false, ms: Date.now() - started, detail };
  }
}

/** 상태 등급은 순수 함수로 뽑는다 — 네트워크 없이 검증할 수 있어야 한다 */
export function summarize(checks: CheckResult[]): HealthStatus {
  const ok = checks.filter((c) => c.ok).length;
  if (ok === checks.length) return "ok";
  if (ok === 0) return "down";
  return "degraded";
}

export async function runHealthChecks(): Promise<HealthReport> {
  const checks = await Promise.all([
    timed("db", () => sql`select 1`, pgCode),
    timed(
      "law_api",
      () => lawSearch("law", { query: "상법", display: 1 }),
      (e) => (e instanceof LawApiError ? e.kind : "ERROR"),
    ),
    timed(
      "claude_api",
      () => anthropic.models.list({ limit: 1 }),
      (e) => {
        // SDK 오류는 status만 집는다. message에는 요청 정보가 붙는다.
        const s = e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : null;
        return typeof s === "number" ? `HTTP_${s}` : "ERROR";
      },
    ),
  ]);

  const b = await budgetState();

  return {
    status: summarize(checks),
    checks,
    budget: {
      spentUsd: Number(b.spentUsd.toFixed(4)),
      budgetUsd: b.budgetUsd,
      allowed: b.allowed,
      warning: b.warning,
      calls: b.calls,
    },
    checkedAt: new Date().toISOString(),
  };
}
