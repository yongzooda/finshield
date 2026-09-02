/**
 * 열거 정합 대조 — types.ts ↔ DB CHECK 제약 (Q-5의 코드 측 게이트).
 *
 * 정본은 DB다. 이 테스트가 깨지면 types.ts가 낡은 것이고, 고치면서
 * 기능 명세·데이터 명세·DB 명세서도 동시 갱신한다 (N-801).
 * 문서(10-db.md)가 마이그레이션 0003보다 낡아 추출 게이트가 오작동했던
 * 사고의 재발 방지 장치다 — 문서 대신 DB를 읽는다.
 *
 * DATABASE_URL이 없거나 CI면 전체 skip — 실패가 아니다 (src/test/live.ts).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { dbReady } from "@/test/live";
import { afterAll, describe, expect, it } from "vitest";
import {
  CACHE_SOURCES, CORPUS_SIZE, DB_CHANNELS, DB_TRAITS, EVENT_TYPES, LABEL_SOURCES,
  ORDER_TYPES, PRODUCT_CODES, REPORT_STATUSES, SECTORS, STAT_CATEGORIES,
  TIMELINE_DOMAINS, VERDICTS,
} from "../types";

function loadDsn(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envFile = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
    const line = envFile.split("\n").find((l) => l.startsWith("DATABASE_URL"));
    return line?.split("=", 2)[1]?.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const dsn = dbReady ? loadDsn() : undefined;

describe.skipIf(!dsn)("types.ts ↔ DB CHECK 제약 (Q-5)", () => {
  const sql = postgres(dsn ?? "", { max: 1, connect_timeout: 10 });
  afterAll(() => sql.end());

  /** pg_get_constraintdef의 ARRAY['A'::text, 'B'::text] 부분에서 열거값 추출 */
  async function dbEnum(table: string, constraint: string): Promise<string[]> {
    const rows = await sql<{ def: string }[]>`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = ${table}::regclass and conname = ${constraint}`;
    expect(rows.length, `${table}.${constraint} 제약이 DB에 없다`).toBe(1);
    const values = [...rows[0].def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]);
    expect(values.length, `${constraint}에서 열거 파싱 실패: ${rows[0].def}`).toBeGreaterThan(0);
    return values.sort();
  }

  const CASES: Array<[string, string, readonly string[]]> = [
    ["cases", "cases_sector_check", SECTORS],
    ["cases", "cases_channel_check", DB_CHANNELS],
    ["cases", "cases_product_code_check", PRODUCT_CODES],
    ["cases", "cases_verdict_check", VERDICTS],
    ["cases", "cases_order_type_check", ORDER_TYPES],
    ["cases", "cases_label_source_check", LABEL_SOURCES],
    ["case_traits", "case_traits_trait_check", DB_TRAITS],
    ["terms_clauses", "terms_clauses_sector_check", SECTORS],
    ["terms_clauses", "terms_clauses_product_code_check", PRODUCT_CODES],
    ["risk_patterns", "risk_patterns_channel_check", DB_CHANNELS],
    ["risk_patterns", "risk_patterns_trait_check", DB_TRAITS],
    ["error_reports", "error_reports_status_check", REPORT_STATUSES],
    ["error_reports", "error_reports_channel_check", DB_CHANNELS],
    ["usage_counters", "usage_counters_event_type_check", EVENT_TYPES],
    ["statute_cache", "statute_cache_source_check", CACHE_SOURCES],
    ["statute_timeline", "statute_timeline_domain_check", TIMELINE_DOMAINS],
    ["validation_stats", "validation_stats_category_check", STAT_CATEGORIES],
  ];

  for (const [table, constraint, expected] of CASES) {
    it(`${table}.${constraint}`, async () => {
      expect(await dbEnum(table, constraint)).toEqual([...expected].sort());
    });
  }

  it("issue_tags — 코드에 열거를 두지 않는 대신 룩업 존재만 확인 (D-1)", async () => {
    const [{ n }] = await sql<[{ n: string }]>`select count(*) as n from issue_tags where active`;
    expect(Number(n)).toBeGreaterThanOrEqual(31);
  });

  it("risk_patterns.stat_basis — DDL default가 아니라 실제 DECISION 수 기준", async () => {
    // 크기를 박아두지 않는다 — 코퍼스 증분(2026.08.30 회수 +28)마다 깨진다.
    // 계약은 «집계 기반 표기 = cases의 실제 DECISION 수»다. 어긋나면 적재 후
    // aggregate_patterns.sql 재실행을 빠뜨린 것이다.
    const [{ n }] = await sql<[{ n: number }]>`
      select count(*)::int as n from cases where source_type = 'DECISION'`;
    const rows = await sql<{ stat_basis: string }[]>`
      select distinct stat_basis from risk_patterns`;
    expect(rows.map((r) => r.stat_basis)).toEqual([`DECISION_${n}`]);
  });

  it("CORPUS_SIZE — 랜딩 배지가 거는 건수 = cases 실제 행 수", async () => {
    // 랜딩은 DB가 죽어도 떠야 하고 정적 LCP 목표가 걸려 있어 이 한 문장을 위해
    // 쿼리를 붙일 수 없다. 그래서 상수로 두고 드리프트를 여기서 잡는다.
    // 실제로 2026.08.30 회수 적재(360 → 388) 때 배지만 360에 남아 화면이 없는
    // 수치를 말하고 있었다 — 코퍼스를 적재하면 types.ts의 CORPUS_SIZE도 고친다.
    const [{ n }] = await sql<[{ n: number }]>`select count(*)::int as n from cases`;
    expect(CORPUS_SIZE).toBe(n);
  });
});
