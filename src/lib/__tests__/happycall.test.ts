/**
 * 해피콜 연습 시나리오 (SR-214 · R-06).
 *
 * 잡으려는 것 셋:
 *   · **깨진 분기** — next가 없는 노드를 가리키거나, 도달 불가 노드가 생기면
 *     연습이 중간에 끊긴다. 자료 단계에서 막는다
 *   · **해설 없는 선택지** — 해설이 연습의 본체다. 답만 고르게 하는 건 퀴즈지 연습이 아니다
 *   · **금지 표현** — 유불리 단정·권유·법률 자문 톤 (P-2 · SR-X02)
 */

import { describe, expect, it } from "vitest";
import { HAPPYCALL_SCENARIOS, TM_INSURANCE, validateScenario } from "../happycall";

describe("해피콜 시나리오 무결성 (SR-214)", () => {
  it("모든 시나리오의 분기가 온전하다 — 깨진 참조·도달 불가·중복 없음", () => {
    for (const s of HAPPYCALL_SCENARIOS) {
      expect(validateScenario(s), s.id).toEqual([]);
    }
  });

  it("모든 노드에 「모른다·기억 안 난다」 계열의 도피로가 있거나 3지선다다 — 억지 답 방지", () => {
    // A11Y 원칙(모름 상시 제공)의 연습판 — 이지선다로 몰지 않는다
    for (const n of TM_INSURANCE.nodes) {
      expect(n.answers.length, `${n.id}: 선택지 수`).toBeGreaterThanOrEqual(3);
    }
  });

  it("모든 노드가 why(근거)를 가진다 — 출처 없는 질문을 만들지 않는다", () => {
    for (const n of TM_INSURANCE.nodes) {
      expect(n.why.trim().length, n.id).toBeGreaterThan(10);
    }
  });

  it("유불리 단정·권유·자문 표현이 없다 — 전 시나리오 (P-2 · SR-X02)", () => {
    for (const sc of HAPPYCALL_SCENARIOS) {
      const all = [
        ...sc.intro,
        ...sc.outro,
        ...sc.nodes.flatMap((n) => [
          n.question,
          n.why,
          ...n.answers.flatMap((a) => [a.label, a.meaning]),
        ]),
      ].join("\n");
      for (const banned of [
        "유리합니다", "불리합니다", "이길 수", "승소", "배상받을 수 있",
        "이렇게 답하세요", "라고 답해야 유리", "속지 마세요", "거짓말",
      ]) {
        expect(all, `${sc.id} 금지 표현: ${banned}`).not.toContain(banned);
      }
    }
  });

  it("중심 메시지가 「사실대로」·「시험이 아니다」다 — 전 시나리오", () => {
    for (const sc of HAPPYCALL_SCENARIOS) {
      const all = [...sc.intro, ...sc.outro].join("\n");
      expect(all, sc.id).toContain("사실");
      expect(all, sc.id).toContain("시험이 아니");
    }
  });

  it("녹음·기록의 성격을 시작 전에 밝힌다 — 전 시나리오", () => {
    for (const sc of HAPPYCALL_SCENARIOS) {
      expect(sc.intro.join("\n"), sc.id).toContain("녹음");
    }
  });

  it("방카 시나리오는 분기가 실제로 갈린다 — 「보험인 줄 몰랐다」는 확인 단계를 거친다", async () => {
    const { BANCA_INSURANCE } = await import("../happycall");
    const first = BANCA_INSURANCE.nodes.find((n) => n.id === BANCA_INSURANCE.start)!;
    const nexts = new Set(first.answers.map((a) => a.next));
    expect(nexts.size, "첫 질문의 분기가 하나로 합쳐져 있다").toBeGreaterThan(1);
    expect(nexts.has("clarify")).toBe(true);
  });
});
