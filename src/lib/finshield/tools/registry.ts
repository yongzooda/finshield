/**
 * 공식 등록부와 상품·기관 조회.
 *
 * 여기서 나오는 근거는 이미 적재된 공식 Snapshot 을 가리킨다. 새로 만들지 않는다.
 * `record_source_snapshot` 은 identity 가 같으면 있는 행을 그대로 돌려주므로,
 * 적재 때 쓴 식별자를 그대로 넘겨 같은 Snapshot 에 붙는다.
 *
 * 등록부에 없다는 사실은 사기라는 뜻이 아니다. 「등록부에서 확인되지 않았다」로만
 * 남기고 판단은 Agent 가 한다 (EV-008).
 */

import "server-only";
import type postgres from "postgres";
import type { SourceItem, ToolCallContext, ToolOutcome } from "./runtime";

type Sql = ReturnType<typeof postgres>;

type SnapshotRow = {
  id: string; source_type: string; authority_level: "A" | "B" | "C" | "D";
  publisher_name: string; source_title: string; canonical_url: string | null;
  official_id: string | null; source_version: string | null; content_hash: string;
  source_fingerprint: string; published_at: string | null; effective_from: string | null;
  license_code: string | null; is_complete: boolean; is_citable: boolean;
  freshness_status: "FRESH" | "STALE" | "UNKNOWN";
};

const toItem = (
  row: SnapshotRow,
  locator: Record<string, unknown>,
  excerpt: string,
  reason: string,
  directness: SourceItem["directness"] = "DIRECT",
): SourceItem => ({
  sourceType: row.source_type,
  // D 등급은 근거 등급으로 쓰지 않는다. 이 도구는 A~C 만 낸다.
  authorityGrade: row.authority_level === "D" ? "C" : row.authority_level,
  publisher: row.publisher_name,
  title: row.source_title,
  officialId: row.official_id,
  canonicalUrl: row.canonical_url,
  publishedAt: row.published_at,
  effectiveFrom: row.effective_from,
  sourceVersion: row.source_version,
  contentHash: row.content_hash,
  fingerprint: row.source_fingerprint,
  freshness: row.freshness_status,
  licenseCode: row.license_code,
  isComplete: row.is_complete,
  isCitable: row.is_citable,
  locator,
  excerptMasked: excerpt,
  directness,
  referenceOnly: false,
  selectionReasonCode: reason,
});

const SNAPSHOT_FIELDS = `id, source_type, authority_level::text as authority_level, publisher_name,
  source_title, canonical_url, official_id, source_version, content_hash, source_fingerprint,
  to_char(published_at, 'YYYY-MM-DD') as published_at, to_char(effective_from, 'YYYY-MM-DD') as effective_from,
  license_code, is_complete, is_citable, freshness_status::text as freshness_status`;

/** 주어진 값이 등록된 공식 채널인지 본다. 값은 정규화해서 맞춘다. */
export const lookupOfficialChannel = async (input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> => {
  const sql = ctx.sql as Sql;
  const values = Array.isArray((input as { values?: unknown })?.values)
    ? ((input as { values: unknown[] }).values.filter((v) => typeof v === "string") as string[])
    : [];
  const normalized = values.map((value) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[-\s]/g, ""));
  if (normalized.length === 0) {
    return { items: [], provenanceComplete: true, candidateCount: 0, reasonCode: "EMPTY_INPUT" };
  }

  const rows = await sql`
    select r.institution_code, r.channel_type, r.normalized_value, r.display_value,
           s.id, s.source_type, s.authority_level::text as authority_level, s.publisher_name,
           s.source_title, s.canonical_url, s.official_id, s.source_version, s.content_hash,
           s.source_fingerprint,
           to_char(s.published_at, 'YYYY-MM-DD') as published_at,
           to_char(s.effective_from, 'YYYY-MM-DD') as effective_from,
           s.license_code, s.is_complete, s.is_citable,
           s.freshness_status::text as freshness_status
      from kb.official_channel_registry r
      join kb.source_snapshots s on s.id = r.source_snapshot_id
     where r.normalized_value = any(${normalized})
       and (r.valid_to is null or r.valid_to >= current_date)`;

  const items = rows.map((row) => toItem(
    row as unknown as SnapshotRow,
    { kind: "official_channel", institution_code: row.institution_code, channel_type: row.channel_type },
    `${row.institution_code} 의 공식 ${row.channel_type}: ${row.display_value}`,
    "OFFICIAL_CHANNEL_MATCH",
  ));

  return {
    items,
    observations: {
      schema_version: "1",
      kind: "channel_lookup",
      // 등록부에서 확인되지 않았다는 사실. 이것만으로 사기라고 말하지 않는다.
      unmatched: normalized.filter((value) => !rows.some((row) => row.normalized_value === value)),
    },
    provenanceComplete: true,
    candidateCount: normalized.length,
    reasonCode: items.length === 0 ? "NO_MATCH" : null,
  };
};

const searchSnapshots = async (
  sql: Sql, sourceType: string, query: string, reason: string, kind: string,
): Promise<ToolOutcome> => {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { items: [], provenanceComplete: true, candidateCount: 0, reasonCode: "EMPTY_QUERY" };
  }
  const rows = await sql`
    select ${sql.unsafe(SNAPSHOT_FIELDS)}
      from kb.source_snapshots
     where source_type = ${sourceType}
       and source_title ilike ${`%${trimmed}%`}
     order by retrieved_at desc
     limit 10`;
  const items = (rows as unknown as SnapshotRow[]).map((row) => toItem(
    row, { kind, official_id: row.official_id }, row.source_title, reason,
  ));
  return {
    items,
    provenanceComplete: true,
    candidateCount: rows.length,
    // 적재된 목록에 없다고 해서 존재하지 않는 상품은 아니다. 확인 범위를 한계로 남긴다.
    reasonCode: items.length === 0 ? "NO_MATCH_IN_LOADED_CORPUS" : null,
  };
};

export const searchFinancialProduct = async (input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> =>
  searchSnapshots(ctx.sql as Sql, "PRODUCT", String((input as { query?: unknown })?.query ?? ""),
    "PRODUCT_SNAPSHOT_MATCH", "financial_product");

export const verifyFinancialInstitution = async (input: unknown, ctx: ToolCallContext): Promise<ToolOutcome> =>
  searchSnapshots(ctx.sql as Sql, "INSTITUTION", String((input as { query?: unknown })?.query ?? ""),
    "INSTITUTION_SNAPSHOT_MATCH", "financial_institution");

/**
 * 아직 자료가 적재되지 않은 도구. 부르면 빈 결과와 이유를 남긴다.
 *
 * 없는 기능을 있는 것처럼 보이게 하지 않는다 (E-017, OPS-005). 결과가 비었다는
 * 사실이 안전의 근거가 되지 않도록 이유 코드를 함께 남긴다.
 */
export const notLoadedYet = (reasonCode: string) => async (): Promise<ToolOutcome> => ({
  items: [],
  provenanceComplete: true,
  candidateCount: 0,
  reasonCode,
});
