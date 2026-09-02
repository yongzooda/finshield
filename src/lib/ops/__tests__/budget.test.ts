/**
 * N-204 예산 쿼터 검증.
 *
 * 이 기능이 없어서 실제로 사고가 났다 — 측정 도중 크레딧이 소진돼 115건이
 * 400을 받았고, 그 실패가 가짜 수치를 만들었다 (2026.08.17). 그래서 검증할 것은
 * 「막히는가」보다 **「어느 쪽으로 실패하는가」**다.
 */

import { describe, expect, it } from "vitest";
import { costUsd, priceOf, QUOTA_EXCEEDED_MESSAGE } from "../budget";
import type { SqlExec } from "../counters";

describe("단가", () => {
  it("운영 모델 단가를 안다", () => {
    expect(priceOf("claude-opus-5")).toEqual({ input: 5.0, output: 25.0 });
  });

  it("모르는 모델이면 **던진다** — 0으로 세면 쿼터가 있으나 마나가 된다", () => {
    expect(() => priceOf("claude-미래-9")).toThrow(/단가를 모르는 모델/);
  });

  it("입력·출력 단가를 나눠 계산한다", () => {
    // 100만 입력 + 10만 출력 = $5 + $2.5
    expect(costUsd("claude-opus-5", 1_000_000, 100_000)).toBeCloseTo(7.5, 6);
  });
});

describe("실패 방향 (EP-3)", () => {
  const boom = (() => {
    throw new Error("DB 죽음");
  }) as unknown as SqlExec;

  it("기록이 실패해도 삼킨다 — 계량 때문에 판단이 막히면 안 된다", async () => {
    const { recordUsage } = await import("../budget");
    await expect(recordUsage("claude-opus-5", 100, 10, boom)).resolves.toBe(false);
  });

  it("조회가 실패하면 **막는다** — 얼마 썼는지 모르는 채 쓰는 쪽이 위험하다", async () => {
    const { budgetState } = await import("../budget");
    const s = await budgetState(boom);
    expect(s.allowed).toBe(false);
    expect(s.warning).toBe(true);
  });
});

describe("임계", () => {
  const fake = (input: number, output: number) =>
    (() =>
      Promise.resolve([
        { input_tokens: String(input), output_tokens: String(output), calls: 1 },
      ])) as unknown as SqlExec;

  it("예산 안이면 통과하고 경고도 없다", async () => {
    const { budgetState } = await import("../budget");
    const s = await budgetState(fake(10_000, 1_000)); // $0.075
    expect(s.allowed).toBe(true);
    expect(s.warning).toBe(false);
  });

  it("80%를 넘으면 경고하되 아직 막지 않는다 (소프트 알림)", async () => {
    const { budgetState } = await import("../budget");
    const { env } = await import("../../env");
    // 예산의 90%에 해당하는 출력 토큰 — $25/1M 기준
    const out = Math.round(((env.DAILY_BUDGET_USD * 0.9) / 25) * 1_000_000);
    const s = await budgetState(fake(0, out));
    expect(s.warning).toBe(true);
    expect(s.allowed).toBe(true);
  });

  it("100%를 넘으면 막는다 (하드 컷 · EX-404)", async () => {
    const { budgetState } = await import("../budget");
    const { env } = await import("../../env");
    const out = Math.round(((env.DAILY_BUDGET_USD * 1.2) / 25) * 1_000_000);
    const s = await budgetState(fake(0, out));
    expect(s.allowed).toBe(false);
  });
});

describe("이용자 문구", () => {
  it("서비스 전체가 죽은 인상을 주지 않는다 — 열려 있는 곳을 알린다 (EX-401·404)", () => {
    expect(QUOTA_EXCEEDED_MESSAGE).toContain("가입 전 확인");
    expect(QUOTA_EXCEEDED_MESSAGE).toContain("검증 결과");
    expect(QUOTA_EXCEEDED_MESSAGE).toContain("데모");
  });

  it("이용자 책임처럼 읽히지 않는다 (EP-5)", () => {
    for (const bad of ["너무 많이", "과도하게", "남용"]) {
      expect(QUOTA_EXCEEDED_MESSAGE).not.toContain(bad);
    }
  });
});
