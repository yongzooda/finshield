/** 공개 Demo 고정 근거의 재수집 연결은 원문 해시가 같을 때만 쓴다 (규칙 8). */

import { describe, expect, it } from "vitest";
// 운영 스크립트는 JS 로 두고 DB 에 닿지 않는 순수 함수만 시험한다.
import { planSeedRefresh } from "../../../../scripts/kb/refresh-demo-seed-sources.mjs";

const productHash = "a".repeat(64);
const declareHash = "b".repeat(64);
const fetchedAt = "2026-09-11T00:41:00.000Z";
const result = (overrides: Record<string, unknown> = {}) => ({
  blocker_id: "B-SOURCE-03", schema_version: 3, run: { id: 101, attempt: 1 },
  observations: {
    fsc: { snapshots: [{ official_id: "data.go.kr:15094787:햇살론15:202602:1", sha256: productHash, fetched_at: fetchedAt }] },
    official_pages: [
      { role: "DECLARE_CENTER", reachable: true, status: 200, content_sha256: declareHash },
      { role: "GUIDE", reachable: false, status: 200, content_sha256: "c".repeat(64) },
    ],
    registry: { fetched_at: fetchedAt },
    ...overrides,
  },
});
const pins = [
  { snapshot_id: "00000000-0000-4000-8000-000000000001", official_id: "data.go.kr:15094787:햇살론15:202602:1", source_type: "PRODUCT", content_hash: productHash },
  { snapshot_id: "00000000-0000-4000-8000-000000000002", official_id: "kinfa:declare-center", source_type: "GUIDE", content_hash: declareHash },
];

describe("Demo 고정 근거 재수집 연결", () => {
  it("방금 수집한 원문 해시가 같은 고정 근거에만 기록을 잇는다", () => {
    const plan = planSeedRefresh({ pins, result: result() });
    expect(plan.skipped).toEqual([]);
    expect(plan.links.map((link: { officialId: string; adapter: string }) => [link.officialId, link.adapter])).toEqual([
      ["data.go.kr:15094787:햇살론15:202602:1", "data_go_kr_fsc_small_loan"],
      ["kinfa:declare-center", "kinfa_official_page"],
    ]);
    expect(plan.links[1]).toMatchObject({ fetchedAt, requestKey: expect.stringContaining("demo-seed-refresh-run-101") });
  });

  it("원문이 바뀐 자료를 옛 고정 근거의 신선한 기록으로 쓰지 않는다", () => {
    const changed = result({ official_pages: [{ role: "DECLARE_CENTER", reachable: true, status: 200, content_sha256: "d".repeat(64) }] });
    const plan = planSeedRefresh({ pins, result: changed });
    expect(plan.links.map((link: { officialId: string }) => link.officialId)).toEqual(["data.go.kr:15094787:햇살론15:202602:1"]);
    expect(plan.skipped).toMatchObject([{ official_id: "kinfa:declare-center", reason: "CONTENT_CHANGED" }]);
  });

  it("본문을 받지 못한 페이지와 수집하지 않은 자료는 확인한 것으로 세지 않는다", () => {
    const unreachable = result({ official_pages: [{ role: "DECLARE_CENTER", reachable: false, status: 200, content_sha256: declareHash }] });
    expect(planSeedRefresh({ pins, result: unreachable }).skipped).toMatchObject([{ reason: "NOT_OBSERVED" }]);
    const other = [{ ...pins[0], official_id: "kinfa:loan-guide" }];
    expect(planSeedRefresh({ pins: other, result: result() }).skipped).toMatchObject([{ reason: "NOT_OBSERVED" }]);
  });

  it("B-SOURCE-03 결과가 아니거나 실행 번호가 없으면 멈춘다", () => {
    expect(() => planSeedRefresh({ pins, result: { ...result(), blocker_id: "B-SOURCE-02" } })).toThrow();
    expect(() => planSeedRefresh({ pins, result: { ...result(), run: {} } })).toThrow();
  });
});
