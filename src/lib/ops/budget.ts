/**
 * N-204 Claude API 하드 쿼터 — 일 단위 소프트 알림 80% · 하드 컷 100%.
 *
 * ## 왜 필요한가 (2026.08.17 실측)
 *
 * 이게 없어서 실제로 사고가 났다. 검증셋 120건 측정을 돌리는 도중 크레딧이
 * **5건 만에 소진**됐고, 나머지 115건은 400을 받았다. 그런데 측정 하네스가
 * 그 실패를 「형식 오류」로 세어 **커버리지 0.8%라는 가짜 수치**를 만들었다.
 * 쿼터가 있었다면 측정이 시작조차 되지 않았을 것이다 — 소진은 **작업 도중이
 * 아니라 시작 전에** 드러나야 한다.
 *
 * ## 전역이어야 한다
 *
 * 프로세스 메모리로 세면 함수·인스턴스마다 다른 숫자를 본다(세션에서 이미 겪은
 * 문제다). 그래서 DB에 날짜별 합계만 쌓는다 — 개별 호출 행은 남기지 않는다.
 *
 * ## 실패는 안전한 방향으로 (EP-3)
 *
 * - **기록 실패** → 삼킨다. 계량 때문에 이용자의 판단이 막히면 안 된다
 * - **조회 실패** → **막는다.** 얼마 썼는지 모르는 채로 계속 쓰는 것이 더 위험하다
 */

import "server-only";
import { sql } from "../db";
import { env } from "../env";
import { pgCode, type SqlExec } from "./counters";

/**
 * 모델별 단가 (USD / 1M 토큰). 출처: Anthropic 공식 가격표, 2026-06-24 기준.
 *
 * ⚠️ **모르는 모델이면 던진다.** 단가를 모르는 채 0으로 세면 쿼터가 있으나
 * 마나가 된다 — 그 침묵이 이 기능이 막으려는 사고 그 자체다.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

export function priceOf(model: string): { input: number; output: number } {
  const p = PRICING[model];
  if (!p) {
    throw new Error(
      `단가를 모르는 모델이다: ${model}. budget.ts의 PRICING에 추가하고 임계를 재보정할 것 (절대 규칙 4)`,
    );
  }
  return p;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export type BudgetState = {
  /** 오늘 쓴 금액 (USD) */
  spentUsd: number;
  budgetUsd: number;
  /** 0~1 이상. 1을 넘으면 하드 컷이다 */
  ratio: number;
  /** 신규 상담·판단을 시작해도 되는가 (EX-404) */
  allowed: boolean;
  /** 80% 도달 — 운영자 알림 대상 (N-303) */
  warning: boolean;
  calls: number;
};

const SOFT = 0.8;

/** 하루치 사용량을 더한다. 실패는 삼킨다 — 계량이 판단을 막으면 안 된다 */
export async function recordUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  exec: SqlExec = sql,
): Promise<boolean> {
  try {
    await exec`
      insert into api_budget (usage_date, input_tokens, output_tokens, calls)
      values ((now() at time zone 'Asia/Seoul')::date, ${inputTokens}, ${outputTokens}, 1)
      on conflict (usage_date) do update set
        input_tokens  = api_budget.input_tokens  + ${inputTokens},
        output_tokens = api_budget.output_tokens + ${outputTokens},
        calls         = api_budget.calls + 1,
        updated_at    = now()
    `;
    return true;
  } catch (e) {
    // 허용 로그 필드만 (절대 규칙 3) — 모델명과 SQLSTATE는 내용이 아니다
    console.warn(`[ops] budget record failed model=${model} pg=${pgCode(e)}`);
    return false;
  }
}

/**
 * 오늘 상태를 읽는다.
 *
 * ⚠️ 조회가 실패하면 **막는다**(`allowed: false`). 얼마 썼는지 모르는 채
 * 계속 쓰는 쪽이 위험하다 — 예산 초과는 되돌릴 수 없다.
 */
export async function budgetState(exec: SqlExec = sql): Promise<BudgetState> {
  const budgetUsd = env.DAILY_BUDGET_USD;
  try {
    const rows = await exec<{ input_tokens: string; output_tokens: string; calls: number }[]>`
      select input_tokens, output_tokens, calls from api_budget
      where usage_date = (now() at time zone 'Asia/Seoul')::date
    `;
    const r = rows[0];
    const spentUsd = r
      ? costUsd(env.ANTHROPIC_MODEL, Number(r.input_tokens), Number(r.output_tokens))
      : 0;
    const ratio = budgetUsd > 0 ? spentUsd / budgetUsd : 1;
    return {
      spentUsd,
      budgetUsd,
      ratio,
      allowed: ratio < 1,
      warning: ratio >= SOFT,
      calls: r?.calls ?? 0,
    };
  } catch (e) {
    console.warn(`[ops] budget read failed pg=${pgCode(e)}`);
    return { spentUsd: 0, budgetUsd, ratio: 1, allowed: false, warning: true, calls: 0 };
  }
}

/** EX-404 표시 문구 — EX-401(모델 장애)과 같은 말을 쓴다. 이용자에겐 같은 상황이다 */
export const QUOTA_EXCEEDED_MESSAGE =
  "지금은 상담을 시작할 수 없습니다. 오늘 처리할 수 있는 양을 다 썼습니다. " +
  "내일 다시 시도해 주세요. 그동안 「가입 전 확인」과 「검증 결과」, 데모 사례는 " +
  "그대로 이용하실 수 있습니다.";
