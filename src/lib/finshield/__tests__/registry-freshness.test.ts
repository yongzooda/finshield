import { describe, expect, it, vi } from "vitest";
import { lookupOfficialChannel, verifyFinancialInstitution } from "../tools/registry";
import { createRunSession, executeTool, persistToolRuns, type ToolCallContext } from "../tools/runtime";

const snapshot = {
  id: "00000000-0000-4000-8000-000000000001", source_type: "GUIDE", authority_level: "B",
  publisher_name: "서민금융진흥원", source_title: "합성 등록부", canonical_url: "https://www.kinfa.or.kr",
  official_id: "fixture:channel", source_version: "v1", content_hash: "a".repeat(64), source_fingerprint: "b".repeat(64),
  published_at: null, effective_from: null, license_code: null, is_complete: true, is_citable: true,
  freshness_status: "FRESH", retrieved_at: "2026-01-01T00:00:00Z", fresh_until: "2026-01-02T00:00:00Z",
  institution_code: "KINFA", channel_type: "PHONE", normalized_value: "1397", display_value: "1397",
};
function context(over: Partial<typeof snapshot> = {}) {
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray) => {
    const query = parts.join("?");
    if (query.includes("from kb.")) return [{ ...snapshot, ...over }];
    if (query.includes("from public.tool_runs")) return [];
    if (query.includes("insert into public.tool_runs") || query.includes("insert into public.evidences")) return [{ id: "00000000-0000-4000-8000-000000000002" }];
    throw new Error("예상하지 않은 SQL: " + query);
  }), { unsafe: (value: string) => value, json: (value: unknown) => value });
  return { sql: sql as unknown as ToolCallContext["sql"], ownerId: "owner", caseId: "case", runId: "run",
    manifest: { manifestId: "", kbReleaseId: "", agentIds: {}, toolIds: {} } } satisfies ToolCallContext;
}

describe("저장된 등록부의 시간과 출처 등급", () => {
  it("FRESH로 적재됐어도 만료 뒤에는 STALE로 전달한다", async () => {
    const result = await lookupOfficialChannel({ values: ["1397"] }, context());
    expect(result.items[0]).toMatchObject({ freshness: "STALE", retrievedAt: "2026-01-01T00:00:00.000Z", storedSnapshotId: snapshot.id });
  });
  it("만료 시각이 없으면 최신으로 간주하지 않는다", async () => {
    const result = await lookupOfficialChannel({ values: ["1397"] }, context({ fresh_until: "" }));
    expect(result.items[0].freshness).toBe("UNKNOWN");
  });
  it("명시적 STALE을 미래 만료 시각으로 승격하지 않는다", async () => {
    const result = await lookupOfficialChannel({ values: ["1397"] }, context({ freshness_status: "STALE", fresh_until: "2099-01-01T00:00:00Z" }));
    expect(result.items[0].freshness).toBe("STALE");
  });
  it("D 등급을 C 등급으로 바꾸지 않는다", async () => {
    const result = await lookupOfficialChannel({ values: ["1397"] }, context({ authority_level: "D" }));
    expect(result.items).toEqual([]);
  });
  it("기관 제목 일치는 공식 조건의 직접 증거가 아니다", async () => {
    const result = await verifyFinancialInstitution({ query: "서민금융진흥원" }, context());
    expect(result.items[0]).toMatchObject({ directness: "CONTEXT_ONLY", isCitable: false });
  });
  it("캐시 조회의 근거를 저장해도 외부 수집 원장을 추가하지 않는다", async () => {
    const ctx = context(), session = createRunSession(ctx);
    const result = await executeTool(session, "FRAUD_CHANNEL", "lookup_official_channel", "VERIFY_CHANNEL", { values: ["1397"] }, lookupOfficialChannel);
    expect(result.evidence[0].fetched_at).toBe("2026-01-01T00:00:00.000Z");
    const ids = await persistToolRuns(session, "agent", [result.pending]);
    expect(ids.size).toBe(1);
    // SQL 대역은 record_source_snapshot 호출을 허용하지 않는다. 호출했다면 위 저장이 실패한다.
  });
});
