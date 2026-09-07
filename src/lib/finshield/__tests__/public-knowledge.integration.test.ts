import { afterAll, beforeAll, expect, it, vi } from "vitest";
import postgres from "postgres";
import { getSourceSnapshot, searchDisputeCase } from "../tools/public-knowledge";
import { queryWithSignal } from "../query-signal";
import type { ToolCallContext } from "../tools/runtime";
const enabled = process.env.FINSHIELD_KB_DEVELOPMENT_DB === "1";
const sql = postgres("postgres://postgres:local@127.0.0.1:55437/finshield_account_deletion", { max: 2 });
let ctx: ToolCallContext;
beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv("COHERE_API_KEY", "");
  const [release] = await sql`select id from kb.kb_releases where version='precase-loan-development-12fd89c'`;
  if (!release) throw new Error("격리 공용 코퍼스를 먼저 적재해야 합니다");
  ctx = { sql, manifest: { kbReleaseId: release.id } } as unknown as ToolCallContext;
});
afterAll(async () => { vi.unstubAllEnvs(); await sql.end(); });
it.skipIf(!enabled)("실제 공용 FTS 검색·원문 재조회·다른 Release 분리", async () => {
  const result = await searchDisputeCase({ query: "대출" }, ctx);
  expect(result.items.length).toBeGreaterThan(0);
  expect(result.items.every(item => item.referenceOnly && !item.isCitable && item.freshness === "UNKNOWN")).toBe(true);
  const source = result.items[0];
  const restored = await getSourceSnapshot({ values: [source.officialId!] }, ctx);
  expect(restored.items.some(item => item.storedSnapshotId === source.storedSnapshotId && item.contentHash === source.contentHash)).toBe(true);
  const elsewhere = await searchDisputeCase({ query: "대출" }, { ...ctx, manifest: { ...ctx.manifest, kbReleaseId: "00000000-0000-4000-8000-000000000000" } });
  expect(elsewhere.items).toEqual([]);
  expect((await searchDisputeCase({ query: "ABSENT_SYNTHETIC_RECORD_XYZ987" }, ctx)).items).toEqual([]);
});
it.skipIf(!enabled)("검색 취소가 실제 PostgreSQL 쿼리를 중단하고 연결을 복구한다", async () => {
  const controller = new AbortController(); const started = Date.now();
  const pending = queryWithSignal(sql`select pg_sleep(5)`, controller.signal);
  const timer = setTimeout(() => controller.abort(), 50);
  try { await expect(pending).rejects.toThrow(); } finally { clearTimeout(timer); }
  expect(Date.now() - started).toBeLessThan(1500);
  expect((await sql`select 1 as ok`)[0].ok).toBe(1);
});
