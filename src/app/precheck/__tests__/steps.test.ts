/**
 * S-02 단계 판정 검증 — 질의 문자열은 이용자가 직접 고칠 수 있으므로
 * **열거 밖 값이 뒤 단계로 새지 않는지**가 핵심이다 (F-605와 같은 태도).
 */

import { describe, expect, it } from "vitest";
import { RESULT_VIEWS, resolveStep, resultSections, stepHref } from "../steps";
import { RESULT_SECTION_META } from "../views";
import { PRODUCT_LABELS, CHANNEL_LABELS, PRODUCT_GROUPS } from "@/lib/labels";
import { PRODUCT_CODES, SLOT_CHANNELS } from "@/lib/types";

describe("S-02 단계 진행", () => {
  it("아무 답도 없으면 상품군 질문이고, 보험이 기본 노출이다", () => {
    const s = resolveStep({});
    expect(s.kind).toBe("product");
    if (s.kind === "product") expect(s.group).toBe("INS");
  });

  it("답이 쌓이는 순서대로 다음 질문으로 넘어간다", () => {
    expect(resolveStep({ product: "INS_WHOLE" }).kind).toBe("channel");
    expect(resolveStep({ product: "INS_WHOLE", channel: "TM" }).kind).toBe("age");
    expect(resolveStep({ product: "INS_WHOLE", channel: "TM", age: "67" }).kind).toBe("result");
  });

  it("앞 질문을 건너뛴 채 뒤 질문으로 가지 않는다 (A11Y-4)", () => {
    expect(resolveStep({ channel: "TM", age: "67" }).kind).toBe("product");
    expect(resolveStep({ product: "INS_WHOLE", age: "67" }).kind).toBe("channel");
  });
});

describe("S-02 열거 대조", () => {
  it("열거 밖 상품군은 무시하고 다시 묻는다", () => {
    expect(resolveStep({ product: "INS_HACKED" }).kind).toBe("product");
    expect(resolveStep({ product: "'; drop table cases; --" }).kind).toBe("product");
  });

  it("열거 밖 채널은 무시하고 다시 묻는다", () => {
    expect(resolveStep({ product: "INS_WHOLE", channel: "CARRIER_PIGEON" }).kind).toBe("channel");
  });

  it("같은 키가 여러 번 와도 배열을 그대로 흘리지 않는다", () => {
    const s = resolveStep({ product: ["INS_WHOLE", "INV_FUND"] });
    expect(s.kind).toBe("channel");
    if (s.kind === "channel") expect(s.product).toBe("INS_WHOLE");
  });

  it("모르는 업권 탭은 기본값으로 접는다", () => {
    const s = resolveStep({ group: "NOPE" });
    if (s.kind === "product") expect(s.group).toBe("INS");
  });
});

describe("S-02 나이 처리", () => {
  const base = { product: "INS_WHOLE", channel: "TM" };

  it("60세 이상이면 ELDER를 자동 파생한다", () => {
    const s = resolveStep({ ...base, age: "67" });
    if (s.kind !== "result") throw new Error("결과 단계여야 한다");
    expect(s.traits).toContain("ELDER");
    expect(s.age).toBe(67);
  });

  it("60세 미만은 파생하지 않는다", () => {
    const s = resolveStep({ ...base, age: "45" });
    if (s.kind !== "result") throw new Error("결과 단계여야 한다");
    expect(s.traits).not.toContain("ELDER");
  });

  it("밝히지 않으면 UNKNOWN으로 결과까지 간다 — 막지 않는다", () => {
    const s = resolveStep({ ...base, age: "UNKNOWN" });
    if (s.kind !== "result") throw new Error("결과 단계여야 한다");
    expect(s.age).toBe("UNKNOWN");
    expect(s.traits).not.toContain("ELDER");
  });

  it("범위 밖·형식 오류는 **조용히 UNKNOWN으로 접지 않고** 다시 묻는다", () => {
    for (const bad of ["18", "121", "쉰일곱", "67.5", "-3"]) {
      const s = resolveStep({ ...base, age: bad });
      expect(s.kind).toBe("age");
      if (s.kind === "age") expect(s.error).toBeTruthy();
    }
  });

  it("처음 묻는 화면에는 오류 문구가 없다", () => {
    const s = resolveStep(base);
    if (s.kind === "age") expect(s.error).toBeUndefined();
  });
});

describe("S-02 표기", () => {
  it("상품군 13종·채널 6종 전부 한국어 표기가 있다", () => {
    for (const c of PRODUCT_CODES) expect(PRODUCT_LABELS[c]?.length).toBeGreaterThan(0);
    for (const c of SLOT_CHANNELS) expect(CHANNEL_LABELS[c]?.length).toBeGreaterThan(0);
  });

  it("업권 묶음이 상품군 13종을 빠짐없이·중복 없이 덮는다", () => {
    const grouped = PRODUCT_GROUPS.flatMap((g) => g.products);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...PRODUCT_CODES].sort());
  });
});

describe("S-02 링크 생성", () => {
  it("앞선 답을 유지한 채 한 항목만 더한다", () => {
    expect(stepHref({ product: "INS_WHOLE" }, { channel: "TM" })).toBe(
      "/precheck?product=INS_WHOLE&channel=TM",
    );
  });

  it("빈 상태면 질의 문자열 없이 첫 질문으로 돌아간다", () => {
    expect(stepHref({}, {})).toBe("/precheck");
  });
});

describe("S-02 오류 시 입력값 보존", () => {
  const base = { product: "INS_WHOLE", channel: "TM" };

  it("범위를 벗어난 값은 되돌려 준다 — 다시 치게 하지 않는다", () => {
    const s = resolveStep({ ...base, age: "999" });
    if (s.kind !== "age") throw new Error("연령 질문이어야 한다");
    expect(s.raw).toBe("999");
  });

  it("정상 흐름에서는 raw를 남기지 않는다", () => {
    const s = resolveStep(base);
    if (s.kind === "age") expect(s.raw).toBeUndefined();
  });
});

describe("S-02 결과 단계의 절 나눔", () => {
  const base = { product: "INV_FUND", channel: "BRANCH", age: "40" };

  it("view가 없으면 첫 절이다 — 예전 링크·즐겨찾기가 그대로 열린다", () => {
    const s = resolveStep(base);
    if (s.kind !== "result") throw new Error("결과 단계여야 한다");
    expect(s.view).toBe("ask");
  });

  it("열거 밖 view는 첫 절로 되돌린다", () => {
    for (const v of ["zzz", "../admin", ""]) {
      const s = resolveStep({ ...base, view: v });
      if (s.kind !== "result") throw new Error("결과 단계여야 한다");
      expect(s.view).toBe("ask");
    }
  });

  it("열거 안의 view는 그대로 실린다", () => {
    for (const v of RESULT_VIEWS) {
      const s = resolveStep({ ...base, view: v });
      if (s.kind !== "result") throw new Error("결과 단계여야 한다");
      expect(s.view).toBe(v);
    }
  });

  it("멈춤 신호가 없으면 그 절도 없다 — 빈 화면으로 넘기지 않는다", () => {
    const withSignals = resultSections({
      brief: { questions: [], signals: [{ text: "s", basis: "b" }] },
      product: "BNK_LOAN",
    });
    const without = resultSections({
      brief: { questions: [], signals: [] },
      product: "BNK_LOAN",
    });
    expect(withSignals).toContain("stop");
    expect(without).not.toContain("stop");
  });

  it("확인 전화 절은 보험 상품군에만 있다 (SR-214)", () => {
    const brief = { questions: [], signals: [] };
    expect(resultSections({ brief, product: "INS_SILSON" })).toContain("call");
    expect(resultSections({ brief, product: "INV_FUND" })).not.toContain("call");
    expect(resultSections({ brief, product: "BNK_LOAN" })).not.toContain("call");
  });

  it("절 순서는 이용자의 시간 순서다 — 근거(집계)가 마지막이다", () => {
    const s = resultSections({
      brief: { questions: [], signals: [{ text: "s", basis: "b" }] },
      product: "INS_WHOLE",
    });
    expect(s).toEqual(["ask", "stop", "call", "docs", "why"]);
  });

  it("모든 절에 화면 문구가 있다 — 제목 없는 단계가 생기면 안 된다", () => {
    for (const key of RESULT_VIEWS.filter((v) => v !== "all")) {
      expect(RESULT_SECTION_META[key].title.length).toBeGreaterThan(0);
      expect(RESULT_SECTION_META[key].short.length).toBeGreaterThan(0);
    }
  });
});
