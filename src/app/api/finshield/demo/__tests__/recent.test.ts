import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[], fail: false }));
vi.mock("@/lib/finshield/db", () => ({
  fsql: () => vi.fn(() => state.fail ? Promise.reject(new Error("db")) : Promise.resolve(state.rows)),
}));

const { GET } = await import("../recent/route");

describe("GET /api/finshield/demo/recent", () => {
  beforeEach(() => { state.rows = []; state.fail = false; });

  it("가장 최근 성공 실행을 지난 실제 실행으로 표시해 돌려준다", async () => {
    state.rows = [{ result_manifest: { schema_version: "demo-result-v2", overall_result: "MATERIAL_RISK_FOUND" }, computed_at: "2026-09-10T22:56:00Z" }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
    expect(await response.json()).toMatchObject({
      mode: "RECENT_LIVE", is_precomputed: false, computed_at: "2026-09-10T22:56:00.000Z", overall_result: "MATERIAL_RISK_FOUND",
    });
  });

  it("보여 줄 결과가 없거나 읽지 못하면 결과를 만들지 않는다", async () => {
    expect((await GET()).status).toBe(404);
    state.fail = true;
    expect((await GET()).status).toBe(503);
  });
});
