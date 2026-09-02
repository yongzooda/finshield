/**
 * 집계 질의가 실제 DB에서 도는지 — 값이 아니라 **형태**를 본다.
 *
 * 수치는 코퍼스가 늘면 바뀌므로 고정하지 않는다. 대신 기관 화면이 성립하기
 * 위한 성질을 고정한다 — 건수 없는 칸이 없을 것, 모집단이 함께 올 것.
 */
import { describe, expect, it } from "vitest";
import { dbReady } from "@/test/live";

describe.skipIf(!dbReady)("③ 개선 축 집계 (DB 왕복)", () => {
  it("채널×쟁점 — 모집단과 부착률을 함께 돌려준다", async () => {
    const { channelIssueMatrix } = await import("../aggregate");
    const m = await channelIssueMatrix();
    expect(m.corpus).toBeGreaterThan(0);
    expect(m.labelled).toBeGreaterThan(0);
    expect(m.labelled).toBeLessThanOrEqual(m.corpus);
    expect(m.channels.length).toBeGreaterThan(0);
    for (const [key, c] of Object.entries(m.cells)) {
      expect(c.n, key).toBeGreaterThan(0);
      expect(c.upheld + c.rejected, key).toBeLessThanOrEqual(c.n);
    }
    expect(m.channels.reduce((s, c) => s + c.n, 0)).toBe(m.labelled);
  });

  it("반복 쟁점 — 배상비율은 별도 표본이라 따로 센다", async () => {
    const { issueRows } = await import("../aggregate");
    const { corpus, rows } = await issueRows();
    expect(corpus).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.n, r.code).toBeGreaterThan(0);
      expect(r.rateN, r.code).toBeLessThanOrEqual(r.n);
      if (r.rateN === 0) expect(r.rateMedian, r.code).toBeNull();
      else expect(r.rateMedian, r.code).not.toBeNull();
    }
    expect(rows.map((r) => r.n)).toEqual([...rows.map((r) => r.n)].sort((a, b) => b - a));
  });

  it("소비자 특성 — 가장 얇은 축이라 부착률을 반드시 함께 준다", async () => {
    const { traitDistribution } = await import("../aggregate");
    const d = await traitDistribution();
    expect(d.corpus).toBeGreaterThan(0);
    expect(d.labelled).toBeLessThanOrEqual(d.corpus);
    for (const r of d.rows) {
      expect(r.n, r.trait).toBeGreaterThan(0);
      expect(Array.isArray(r.topIssues), r.trait).toBe(true);
    }
  });

  it("채널별 점검 항목 — 채널마다 잦은 쟁점이 붙는다", async () => {
    const { channelChecklists } = await import("../aggregate");
    const { labelled, rows } = await channelChecklists();
    expect(labelled).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.n, r.channel).toBeGreaterThan(0);
      expect(r.issues.length, r.channel).toBeLessThanOrEqual(5);
    }
  });
});
