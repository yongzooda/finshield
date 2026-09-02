/**
 * F-503 `search_case` — 유사 조정례 검색 (SR-303).
 *
 * 읽기 전용이다. 쓰기 연산이 없다.
 *
 * **Q-2 인용 제한이 이 도구의 핵심 제약이다.** 검색은 `cases` 388건 전체를
 * 대상으로 하되, **인용 가능한 사례는 `citable_cases` 뷰 소속(225건)뿐**이다.
 * 의결번호 없는 사례를 근거로 내보내면 환각 방지 규칙과 정합이 깨진다.
 * 그래서 이 도구는 아예 뷰에서만 조회한다 — 인용 불가 사례가 반환될 경로를 두지 않는다.
 *
 * **의결일은 반환하지 않는다.** F-503 문구는 「의결번호·의결일 포함 필수」이지만
 * 실물 225건 전부 `decision_date`가 NULL이다(원본 미기재, 마이그레이션 0004에서
 * 필수 해제). 없는 날짜를 지어내지 않고 **「의결번호(연도)」** 형식으로 반환한다.
 *
 * 검색 전략 (DB 명세서 7장):
 *   1차 구조 필터 — sector · product_code · channel · trait · issue
 *   유사도       — pg_trgm `word_similarity` (`facts_summary` GIN 인덱스)
 *   `UNKNOWN` 슬롯은 해당 필터를 적용하지 않는다 (F-503)
 *
 * **`similarity`가 아니라 `word_similarity`를 쓴다.** `similarity`는 두 문자열
 * 전체의 트라이그램 집합을 비교하므로, 수천 자짜리 사실관계와 한 문장짜리 질의를
 * 견주면 값이 0에 수렴한다. 실측(225건)에서 범위 0~0.027 · 평균 0.005였고 상위
 * 결과가 전부 800~900자대 짧은 문서로 쏠렸다 — 길이 편향이지 내용 일치가 아니다.
 * `word_similarity(질의, 본문)`은 질의와 가장 잘 맞는 본문 구간을 보므로 길이에
 * 휘둘리지 않는다. 같은 조건에서 범위 0~0.55 · 평균 0.129였고 3,843자 문서도
 * 상위에 올랐다.
 */

import "server-only";
import { sql } from "../db";
import { filterFields } from "./filter";
import type { DbChannel, DbTrait, ProductCode, Sector, Verdict } from "../types";

export type SearchCaseInput = {
  /** 업권. 미확정이면 생략 — 필터를 걸지 않는다 */
  sector?: Sector;
  productCode?: ProductCode;
  /** 판매채널. UNKNOWN은 생략과 같다 (DB에 UNKNOWN 값이 없다 — D-2) */
  channel?: DbChannel;
  /** 소비자 특성. NONE은 제외하고 넘긴다 */
  traits?: readonly DbTrait[];
  /** 쟁점 태그 코드 (issue_tags.code) */
  issues?: readonly string[];
  /** 사실관계 유사도 비교용 텍스트. 정제 사실관계이며 사용자 원문이 아니다 */
  factsText?: string;
  limit?: number;
};

export type SimilarCase = {
  /** 인용 표기용 — 「제2022-8호(2022)」 형태로 조립해 쓴다 */
  decisionNo: string;
  caseYear: number | null;
  sector: Sector;
  productCode: ProductCode | null;
  channel: DbChannel | null;
  verdict: Verdict;
  /** 배상비율. 예측치로 표시하지 않는다 — 참고 사례 병기 시에만 (SR-X10) */
  compensationRate: number | null;
  factsSummary: string;
  issues: string[];
  /** pg_trgm `word_similarity` 0~1. factsText가 없으면 null */
  similarity: number | null;
  sourceUrl: string | null;
};

export type SearchCaseResult = {
  cases: SimilarCase[];
  /** 필터 조건에 걸린 인용 가능 사례 총수 (limit 적용 전) */
  matchedTotal: number;
  /** F-606 필터에 걸린 구간 수. 0이 아니면 실행 로그에 남긴다 */
  flagged: number;
  /** 실제로 적용된 필터 — 실행 로그와 「미확인 슬롯」 표시에 쓴다 */
  appliedFilters: string[];
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

type Row = {
  decision_no: string;
  case_year: number | null;
  sector: Sector;
  product_code: ProductCode | null;
  channel: DbChannel | null;
  verdict: Verdict;
  compensation_rate: number | null;
  facts_summary: string;
  issues: string[] | null;
  similarity: number | null;
  source_url: string | null;
  total: string;
};

export async function searchCase(input: SearchCaseInput): Promise<SearchCaseResult> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const traits = (input.traits ?? []).filter(Boolean);
  const issues = (input.issues ?? []).filter(Boolean);
  const facts = input.factsText?.trim() || null;

  const applied: string[] = [];
  if (input.sector) applied.push(`업권=${input.sector}`);
  if (input.productCode) applied.push(`상품군=${input.productCode}`);
  if (input.channel) applied.push(`채널=${input.channel}`);
  if (traits.length) applied.push(`특성=${traits.join(",")}`);
  if (issues.length) applied.push(`쟁점=${issues.join(",")}`);
  if (facts) applied.push("사실관계 유사도");

  // 인용 가능 사례(citable_cases)만 대상으로 한다 — Q-2.
  // 필터는 인자가 없으면 통과시키는 형태로 짜, UNKNOWN 슬롯이 조건을 좁히지 않게 한다.
  const rows = await sql<Row[]>`
    with filtered as (
      select c.id, c.decision_no, c.case_year, c.sector, c.product_code, c.channel,
             c.verdict, c.compensation_rate, c.facts_summary, c.source_url,
             case when ${facts}::text is null then null
                  else word_similarity(${facts}, c.facts_summary) end as similarity
      from citable_cases c
      where (${input.sector ?? null}::text is null or c.sector = ${input.sector ?? null})
        and (${input.productCode ?? null}::text is null or c.product_code = ${input.productCode ?? null})
        and (${input.channel ?? null}::text is null or c.channel = ${input.channel ?? null})
        and (${traits.length === 0} or exists (
              select 1 from case_traits ct
              where ct.case_id = c.id and ct.trait = any(${traits as string[]}::text[])))
        and (${issues.length === 0} or exists (
              select 1 from case_issues ci join issue_tags t on t.id = ci.issue_tag_id
              where ci.case_id = c.id and t.code = any(${issues as string[]}::text[])))
    )
    select f.decision_no, f.case_year, f.sector, f.product_code, f.channel,
           f.verdict, f.compensation_rate, f.facts_summary, f.similarity, f.source_url,
           (select array_agg(t.code order by t.code)
              from case_issues ci join issue_tags t on t.id = ci.issue_tag_id
             where ci.case_id = f.id) as issues,
           count(*) over () as total
    from filtered f
    order by f.similarity desc nulls last, f.case_year desc nulls last, f.decision_no
    limit ${limit}`;

  let flagged = 0;
  const cases: SimilarCase[] = rows.map((r) => {
    // 조정례 원문에서 추출한 텍스트다 — 자료로만 쓰이도록 무해화한다 (F-606)
    const { row, flagged: n } = filterFields(r, ["facts_summary"]);
    flagged += n;
    return {
      decisionNo: row.decision_no,
      caseYear: row.case_year,
      sector: row.sector,
      productCode: row.product_code,
      channel: row.channel,
      verdict: row.verdict,
      compensationRate: row.compensation_rate,
      factsSummary: row.facts_summary,
      issues: row.issues ?? [],
      similarity: row.similarity === null ? null : Number(row.similarity),
      sourceUrl: row.source_url,
    };
  });

  return {
    cases,
    matchedTotal: rows.length ? Number(rows[0].total) : 0,
    flagged,
    appliedFilters: applied,
  };
}

/**
 * 인용 표기 — 의결일이 없으므로 「의결번호(연도)」로 조립한다.
 * 화면·프롬프트 어디서든 이 함수를 거치게 해 표기가 갈라지지 않도록 한다.
 */
export function citation(c: Pick<SimilarCase, "decisionNo" | "caseYear">): string {
  return c.caseYear ? `${c.decisionNo}(${c.caseYear})` : c.decisionNo;
}
