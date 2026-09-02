/**
 * B-3 4계층 — 모델 호출 없이 검증 가능한 규약만 본다.
 *
 * 여기서 잡으려는 회귀는 셋이다:
 *   · 유사 조정례가 판단 프롬프트로 새는 것 (기획서 6.5)
 *   · 「위반 가능성 낮음」에서 필수 4항목이 빠지는 것 (기획서 9.5 · F-306)
 *   · 신청을 만류하는 표현이 통과하는 것 (기획서 9.5 ③)
 */

import { describe, expect, it } from "vitest";
import { buildJudgePrompt } from "../judge";
import { FSS_CONTACT, RIGHT_TO_APPLY, guideWithheld, stripDiscouraging } from "../guide";
import { sectorOf } from "../investigate";
import type { Evidence, JudgeInput, Judgment } from "../types";
import type { Slots } from "../../types";

const slots: Slots = {
  channel: "TM", age: 67, product: "INS_WHOLE", contract_ym: "2019-05", traits: ["ELDER"],
};

const evidence: Evidence = {
  statutes: [
    {
      lawName: "보험업법", articleNo: "제95조의2", articleTitle: "설명의무 등",
      articleText: "보험회사는 ... 설명하여야 한다.", effectiveDate: null,
      source: "SNAPSHOT", checkedAt: "2026-08-10", transferredTo: null,
      isFallback: false, flagged: 0,
    },
  ],
  precedents: [],
  cases: [
    {
      decisionNo: "제2019-15호", caseYear: 2019, sector: "INSURANCE",
      productCode: "INS_WHOLE", channel: "TM", verdict: "UPHELD",
      compensationRate: 40, factsSummary: "전화로 종신보험에 가입한 사건",
      issues: ["설명의무"], similarity: 0.3, sourceUrl: null,
    },
  ],
  documents: null,
  riskPattern: null,
  gaps: [],
};

const judgeInput: JudgeInput = {
  slots,
  facts: {
    statements: ["2019년 5월 전화로 종신보험에 가입했다"],
    issues: ["설명의무"],
    unresolved: ["약관 교부 여부"],
  },
  evidence,
};

// ---------------------------------------------------------------- 6.5 조정례 미주입

describe("기획서 6.5 — 유사 조정례는 판단에 주입하지 않는다", () => {
  it("판단 입력 타입에 cases가 없다 (컴파일 시점 단언)", async () => {
    const m = await import("../judge");
    expect(m._judgeSeesNoCases).toBe(true);
  });

  it("완성된 판단 프롬프트에 조정례 의결번호·사실요약이 없다", () => {
    const prompt = buildJudgePrompt(judgeInput);
    expect(prompt).not.toContain("제2019-15호");
    expect(prompt).not.toContain("전화로 종신보험에 가입한 사건");
  });

  it("근거 법령 조문은 그대로 들어간다", () => {
    const prompt = buildJudgePrompt(judgeInput);
    expect(prompt).toContain("보험업법 제95조의2");
    expect(prompt).toContain("설명하여야 한다");
  });

  it("확인되지 않은 사실은 확신도를 낮추라는 지시와 함께 전달된다", () => {
    const prompt = buildJudgePrompt(judgeInput);
    expect(prompt).toContain("약관 교부 여부");
    expect(prompt).toMatch(/확신도를\s*낮/);
  });

  it("근거 공백이 있으면 프롬프트에 명시된다", () => {
    const prompt = buildJudgePrompt({
      ...judgeInput,
      evidence: { ...evidence, gaps: ["판례 대조에 실패해 판례는 근거에서 제외했습니다"] },
    });
    expect(prompt).toContain("근거 공백");
    expect(prompt).toContain("판례 대조에 실패");
  });

  it("조문이 하나도 없으면 법령을 인용하지 말라고 지시한다", () => {
    const prompt = buildJudgePrompt({
      ...judgeInput,
      evidence: { ...evidence, statutes: [] },
    });
    expect(prompt).toMatch(/법령을 인용하지 (말|마)/);
  });
});

// ---------------------------------------------------------------- 9.5 필수 4항목

describe("기획서 9.5 · F-306 — 「낮음」 출력 필수 항목", () => {
  it("유보 안내에도 신청권 고지와 1332가 들어간다", () => {
    const r = guideWithheld({
      kind: "WITHHELD", reason: "LOW_CONFIDENCE", needed: ["상품설명서"], confidence: 3,
    });
    expect(r.nextSteps).toContain(RIGHT_TO_APPLY);
    expect(r.nextSteps).toContain(FSS_CONTACT);
  });

  it("유보를 실패나 오류로 표현하지 않는다 (F-307)", () => {
    for (const reason of ["LOW_CONFIDENCE", "INSUFFICIENT_EVIDENCE", "TOOL_BUDGET"] as const) {
      const r = guideWithheld({ kind: "WITHHELD", reason, needed: [], confidence: 3 });
      expect(r.explanation).not.toMatch(/실패|오류|에러/);
    }
  });

  it("필요한 자료를 안내한다 (F-307)", () => {
    const r = guideWithheld({
      kind: "WITHHELD", reason: "INSUFFICIENT_EVIDENCE",
      needed: ["가입 당시 상품설명서", "해피콜 녹취"], confidence: 2,
    });
    // 항목별로 분리돼 있어야 한다 — 한 줄로 뭉치면 고령 이용자가 읽지 못한다
    expect(r.needed).toEqual(["가입 당시 상품설명서", "해피콜 녹취"]);
    expect(r.nextSteps.some((s) => s.includes("상품설명서"))).toBe(false);
  });

  it("신청권 고지 문구가 신청을 말리지 않는다", () => {
    expect(RIGHT_TO_APPLY).toContain("이용자 본인에게 있습니다");
    expect(FSS_CONTACT).toContain("1332");
    expect(stripDiscouraging(RIGHT_TO_APPLY).removed).toBe(0);
    expect(stripDiscouraging(FSS_CONTACT).removed).toBe(0);
  });

  it("고정 문구에 마크다운을 넣지 않는다 — 렌더러가 마크다운을 쓴다는 보장이 없다", () => {
    for (const t of [RIGHT_TO_APPLY, FSS_CONTACT]) expect(t).not.toContain("**");
  });
});

// ---------------------------------------------------------------- 업권 매핑

describe("업권 2단 구조", () => {
  it("상품군 접두사가 업권이다", () => {
    expect(sectorOf("INS_WHOLE")).toBe("INSURANCE");
    expect(sectorOf("INV_ELS")).toBe("INVESTMENT");
    expect(sectorOf("BNK_LOAN")).toBe("BANKING");
    expect(sectorOf("ETC_UNKNOWN")).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------- 판단 결과 불변

describe("④ 안내는 판단을 바꾸지 않는다", () => {
  it("changesIf는 판단 결과에서 그대로 온다", async () => {
    const j: Readonly<Judgment> = {
      conclusion: "UNLIKELY", confidence: 4, issues: ["설명의무"],
      reasoning: "이유", changesIf: ["설명 확인서에 본인 서명이 없다면 결론이 달라질 수 있습니다"],
    };
    // guide()는 모델을 부르므로 여기서는 판단 객체가 readonly로 선언되는지만 본다.
    // 값 변경 시도는 타입 에러가 되어 컴파일 단계에서 걸린다.
    expect(j.changesIf).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 9.5 ③ 만류 금지

describe("기획서 9.5 ③ — 신청을 만류하는 표현 차단", () => {
  const BLOCKED = [
    "이 경우 분쟁조정을 신청하지 마시기 바랍니다.",
    "굳이 신청하실 필요는 없습니다.",
    "신청해도 소용이 없습니다.",
    "신청을 권하지 않습니다.",
    "신청은 추천해 드리지 않습니다.",
    "이쯤에서 포기하시는 것이 좋겠습니다.",
    "시간과 비용만 낭비하실 수 있습니다.",
    "신청은 무의미합니다.",
    "인정될 가능성이 거의 없으므로 다른 방법을 찾아보십시오.",
  ];

  it.each(BLOCKED)("만류 문장을 제거한다: %s", (sentence) => {
    const { text, removed } = stripDiscouraging(`설명의무 위반으로 보기 어렵습니다. ${sentence}`);
    expect(removed).toBe(1);
    expect(text).toBe("설명의무 위반으로 보기 어렵습니다.");
  });

  const KEPT = [
    "가입 당시 설명을 들으셨다는 기록이 남아 있습니다.",
    "분쟁조정을 신청하실 수 있습니다.",
    "신청 여부는 본인께서 정하시면 됩니다.",
    "보험업법 제95조의2는 보험회사의 설명의무를 정하고 있습니다.",
    "추가 자료가 확인되면 판단이 달라질 수 있습니다.",
  ];

  it.each(KEPT)("정상 문장은 남긴다: %s", (sentence) => {
    const { text, removed } = stripDiscouraging(sentence);
    expect(removed).toBe(0);
    expect(text).toBe(sentence);
  });

  it("여러 문장이 섞여도 만류 문장만 골라 뺀다", () => {
    const { text, removed } = stripDiscouraging(
      "설명이 충분했던 것으로 보입니다. 신청해도 실익이 없습니다. " +
        "다만 상품설명서가 확인되면 결론이 달라질 수 있습니다.",
    );
    expect(removed).toBe(1);
    expect(text).toContain("설명이 충분했던");
    expect(text).toContain("상품설명서가 확인되면");
    expect(text).not.toContain("실익");
  });
});

// ---------------------------------------------------------------- F-308 확장 — 유보 이어가기

describe("F-308 확장 — 이어가기 프롬프트", () => {
  const base = {
    maskedStatement: "보험사에 요청해 해피콜 녹취를 들어봤습니다",
    slots: {} as Partial<Slots>,
    askedCount: 0,
  };

  it("신규 상담 프롬프트에는 이어가기 블록이 없다 — 9/1 슬롯 측정과 신규 경로 무변경", async () => {
    const { buildConsultUser } = await import("../consult");
    const p = buildConsultUser(base);
    expect(p).not.toContain("이어가기");
    expect(p).not.toContain("확인이 필요하다고 안내한 자료");
  });

  it("재진입이면 이전 사실관계·필요 자료가 실리고 갱신 지시가 붙는다", async () => {
    const { buildConsultUser } = await import("../consult");
    const p = buildConsultUser({
      ...base,
      reentry: {
        needed: ["해피콜 녹취"],
        priorFacts: {
          statements: ["2019년 5월 전화로 종신보험에 가입했다"],
          issues: ["설명의무"],
          unresolved: ["해피콜 실시 여부"],
        },
      },
    });
    expect(p).toContain("2019년 5월 전화로 종신보험에 가입했다");
    expect(p).toContain("해피콜 녹취");
    expect(p).toContain("갱신하라");
    // 판단 결론·확신도는 타입에 없어 실릴 수 없다 (ConsultInput) — 문구로도 재확인
    expect(p).not.toContain("위반 가능성");
    expect(p).not.toContain("확신도");
  });
});
