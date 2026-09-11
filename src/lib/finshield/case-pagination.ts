/** CASE-004·CASE-006: 생성 시각·ID 복합 Cursor로 새 기록/삭제에 따른 페이지 밀림을 피한다. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export const CASE_PAGE_SIZE = 50;
type Cursor = { created_at: string; id: string };
export function readCaseCursor(raw: string | null): Cursor | null {
  if (raw === null) return null;
  if (!raw || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("INVALID_CASE_CURSOR");
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!value || Object.keys(value).sort().join() !== "created_at,id" || typeof value.created_at !== "string" || !INSTANT.test(value.created_at)
      || !Number.isFinite(Date.parse(value.created_at)) || typeof value.id !== "string" || !UUID.test(value.id)) throw new Error();
    return value;
  } catch { throw new Error("INVALID_CASE_CURSOR"); }
}
export function casePageQuery(cursor: Cursor | null): Record<string, string> {
  return { select: "id,scenario,lifecycle,title_masked,created_at,updated_at,deletion_status,deleted_at,latest_passport_id",
    order: "created_at.desc,id.desc", limit: String(CASE_PAGE_SIZE + 1),
    ...(cursor ? { or: `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))` } : {}) };
}
export function casePage(rows: unknown[]) {
  const cases = rows.slice(0, CASE_PAGE_SIZE);
  const last = cases.at(-1) as Cursor | undefined;
  const next_cursor = rows.length > CASE_PAGE_SIZE && last
    ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64url") : null;
  return { cases, next_cursor };
}
