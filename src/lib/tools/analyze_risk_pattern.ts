/**
 * F-505 `analyze_risk_pattern` — 분쟁 패턴 집계 (SR-305 · DR-105).
 *
 * **이 도구는 계산하지 않는다.** `risk_patterns` 사전 집계표를 읽기만 한다.
 * 런타임에 집계를 만들면 Q-4 위반이고, 모델이 추정하면 F-603 위반이다.
 * 집계 생성은 배치(`scripts/aggregate_patterns.sql`)의 일이다.
 *
 * 표의 구조 — `NULL`은 "이 축을 구분하지 않은 전체"를 뜻한다.
 * 그래서 (상품군, 채널, 특성) 조합이 표에 없을 수 있고, 그때는 **덜 구체적인
 * 조합으로 물러나 읽는다.** 물러나는 것은 계산이 아니라 "어느 사전 집계 행을
 * 읽을지" 고르는 일이며, 어느 단위로 읽었는지를 반환값에 명시한다.
 *
 * 반환은 저장된 건수 그대로다. 비율을 만들어 넣지 않는다 — 표시 계층이
 * 필요하면 건수로부터 만들되, 그때도 분모를 함께 보인다 (검증 수치 병기 원칙).
 */

import "server-only";
import { sql } from "../db";
import type { DbChannel, DbTrait, ProductCode } from "../types";

export type RiskPatternInput = {
  productCode?: ProductCode;
  channel?: DbChannel;
  /** 복수 특성 중 하나로 조회한다. 집계표의 trait 축이 단일값이기 때문이다 */
  trait?: DbTrait;
};

export type IssueFrequency = {
  issueCode: string;
  issueLabel: string;
  /** 해당 조합에서 이 쟁점이 다뤄진 사건 수 */
  nCases: number;
  /** 인용(배상 인정) 건수 */
  nUpheld: number;
  /** 기각 건수 */
  nRejected: number;
};

/** 어느 단위의 사전 집계를 읽었는지 — 화면·로그가 이걸 밝혀야 오해가 없다 */
export type Granularity =
  | "PRODUCT_CHANNEL_TRAIT"
  | "PRODUCT_CHANNEL"
  | "PRODUCT"
  | "OVERALL";

export type RiskPatternResult = {
  granularity: Granularity;
  /** 실제로 매칭된 축 — 요청과 다를 수 있다(물러나 읽은 경우) */
  matched: { productCode: ProductCode | null; channel: DbChannel | null; trait: DbTrait | null };
  issues: IssueFrequency[];
  /** 집계 기준 — 정식 결정서 225건 (stat_basis) */
  statBasis: string;
  /** 요청 조합에 집계가 없어 물러나 읽었는지 */
  fellBack: boolean;
};

type Row = {
  product_code: ProductCode | null;
  channel: DbChannel | null;
  trait: DbTrait | null;
  code: string;
  label_ko: string;
  n_cases: number;
  n_upheld: number;
  n_rejected: number;
  stat_basis: string;
};

/** 구체적인 것부터 시도한다. 각 단계는 사전 집계표의 실제 행 조합이다 */
function candidates(input: RiskPatternInput): Array<{
  g: Granularity;
  p: ProductCode | null;
  c: DbChannel | null;
  t: DbTrait | null;
}> {
  const { productCode: p = null, channel: c = null, trait: t = null } = input;
  const list: ReturnType<typeof candidates> = [];
  if (p && c && t) list.push({ g: "PRODUCT_CHANNEL_TRAIT", p, c, t });
  if (p && c) list.push({ g: "PRODUCT_CHANNEL", p, c, t: null });
  if (p) list.push({ g: "PRODUCT", p, c: null, t: null });
  list.push({ g: "OVERALL", p: null, c: null, t: null });
  return list;
}

export async function analyzeRiskPattern(
  input: RiskPatternInput,
): Promise<RiskPatternResult | null> {
  const tries = candidates(input);

  for (const [i, cand] of tries.entries()) {
    // `is not distinct from`을 써서 NULL 축("전체")을 정확히 집어낸다.
    // `=`로는 NULL 행이 매칭되지 않는다 — 집계표가 NULL을 의미값으로 쓰기 때문이다.
    const rows = await sql<Row[]>`
      select rp.product_code, rp.channel, rp.trait,
             t.code, t.label_ko,
             rp.n_cases, rp.n_upheld, rp.n_rejected, rp.stat_basis
      from risk_patterns rp
      join issue_tags t on t.id = rp.issue_tag_id
      where rp.product_code is not distinct from ${cand.p}
        and rp.channel      is not distinct from ${cand.c}
        and rp.trait        is not distinct from ${cand.t}
      order by rp.n_cases desc, t.code`;

    if (rows.length === 0) continue;

    return {
      granularity: cand.g,
      matched: { productCode: cand.p, channel: cand.c, trait: cand.t },
      issues: rows.map((r) => ({
        issueCode: r.code,
        issueLabel: r.label_ko,
        nCases: r.n_cases,
        nUpheld: r.n_upheld,
        nRejected: r.n_rejected,
      })),
      statBasis: rows[0].stat_basis,
      fellBack: i > 0,
    };
  }

  // 집계표가 비어 있는 경우에만 여기 온다 (EX-501 — 사전 점검 조합의 집계 없음)
  return null;
}
