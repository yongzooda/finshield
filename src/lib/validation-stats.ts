/**
 * S-06 검증 결과 화면의 데이터 조회 (DR-106 · F-403).
 *
 * `validation_stats`가 화면 수치의 **유일한 원천**이다 (Q-3). 이 모듈 밖에서
 * 정확도·커버리지·신뢰구간을 만들어내면 안 된다 — 상수로 박거나, 계산하거나,
 * 모델에게 물어보는 경로가 생기면 그 자체로 F-603 위반이다.
 *
 * `note`가 필수 필드인 이유는 CLAUDE.md 「S-06 렌더링 규약」에 있다.
 * 수치만 렌더하고 단서를 빠뜨리는 코드가 타입 체크를 통과하지 못하게 한다.
 */

import "server-only";
import { sql } from "./db";
import type { STAT_CATEGORIES } from "./types";

export type StatCategory = (typeof STAT_CATEGORIES)[number];

/** 재현 회차별 측정값 — 커버리지처럼 단일 수치로 축약하면 안 되는 지표에 쓴다 */
export type StatRun = {
  run: number;
  value: number;
  numerator: number;
  denominator: number;
};

/**
 * 지표 1행. **`note`는 optional이 아니다** — 컴포넌트가 행 객체를 통째로 받게 하고
 * note를 필수로 두면, 수치만 뽑아 렌더하는 코드가 타입 단계에서 막힌다.
 */
export type ValidationStat = {
  category: StatCategory;
  metricKey: string;
  displayKo: string;
  /** 사람이 읽는 표기. 병기 원칙(84%(71/85 = 83.5%))이 이미 적용된 문자열 */
  display: string;
  /** 한계·단서. 화면에서 숨기거나 접을 수 없다 (S-06 금지사항) */
  note: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  runs: StatRun[] | null;
};

type Row = {
  category: StatCategory;
  metric_key: string;
  display_ko: string;
  value_json: Record<string, unknown>;
  display_order: number;
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function toStat(r: Row): ValidationStat {
  const v = r.value_json;
  const display = typeof v.display === "string" ? v.display : r.display_ko;
  const note = typeof v.note === "string" ? v.note : "";
  // note 없는 행은 적재 게이트에서 걸러진다(18/18행 보유 확인). 그래도 비면
  // 조용히 빈 문자열로 렌더하지 않고 드러낸다 — 한계 표시 누락은 숨기면 안 된다.
  if (!note) {
    throw new Error(
      `validation_stats.${r.metric_key}에 note가 없다 — S-06은 수치만 단독 표시할 수 없다`,
    );
  }
  return {
    category: r.category,
    metricKey: r.metric_key,
    displayKo: r.display_ko,
    display,
    note,
    value: num(v.value),
    numerator: num(v.numerator),
    denominator: num(v.denominator),
    ciLow: num(v.ci_low),
    ciHigh: num(v.ci_high),
    runs: Array.isArray(v.runs) ? (v.runs as StatRun[]) : null,
  };
}

/** 정정 이력 공개분 (F-404 · public_corrections 뷰) */
export type Correction = {
  id: string;
  reportedOn: string;
  correctionNote: string;
  correctedAt: string | null;
};

export type ValidationPageData = {
  headline: ValidationStat[];
  sector: ValidationStat[];
  method: ValidationStat[];
  unverified: ValidationStat[];
  correctionPolicy: ValidationStat[];
  corrections: Correction[];
};

export async function getValidationPageData(): Promise<ValidationPageData> {
  const [rows, corrections] = await Promise.all([
    sql<Row[]>`
      select category, metric_key, display_ko, value_json, display_order
      from validation_stats
      order by display_order`,
    sql<
      { id: string; reported_on: Date; correction_note: string; corrected_at: Date | null }[]
    >`
      select id, reported_on, correction_note, corrected_at
      from public_corrections
      order by corrected_at desc nulls last`,
  ]);

  const stats = rows.map(toStat);
  const of = (c: StatCategory) => stats.filter((s) => s.category === c);

  return {
    headline: of("HEADLINE"),
    sector: of("SECTOR"),
    method: of("METHOD"),
    unverified: of("UNVERIFIED"),
    correctionPolicy: of("CORRECTION_POLICY"),
    corrections: corrections.map((c) => ({
      id: c.id,
      reportedOn: c.reported_on.toISOString().slice(0, 10),
      correctionNote: c.correction_note,
      correctedAt: c.corrected_at?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

/** n이 작아 성능 근거로 쓸 수 없는 구간 — 업권별 행에 경고를 붙이는 기준 */
export const SMALL_SAMPLE_N = 20;

export function isSmallSample(s: ValidationStat): boolean {
  return s.denominator !== null && s.denominator < SMALL_SAMPLE_N;
}
