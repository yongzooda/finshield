/**
 * S-05 공통점·차이점 대비 검증 (F-401).
 *
 * 이 계산에는 모델이 없다. 그래서 검증할 것은 **없는 공통점을 만들어내지
 * 않는가**다 — 조정례 라벨은 축마다 부착률이 다르고(채널 125/388), 비어 있는
 * 것을 일치로 읽으면 "가입 경로가 같습니다"라는 거짓말이 화면에 나간다.
 */

import { describe, expect, it } from "vitest";
import { caseExcerpt, compareCase, similaritySentence, withParticle } from "../compare";
import type { SimilarCase } from "@/lib/tools/search_case";
import type { Slots } from "@/lib/types";

const slots: Slots = {
  channel: "TM", age: 67, product: "INS_WHOLE",
  contract_ym: "2019-05", traits: ["ELDER"], confirm_call: "Y",
};

const base: SimilarCase = {
  decisionNo: "제2019-15호", caseYear: 2019, sector: "INSURANCE",
  productCode: "INS_WHOLE", channel: "TM", verdict: "UPHELD",
  compensationRate: 40, factsSummary: "전화로 종신보험에 가입한 사건",
  issues: ["설명의무"], similarity: 0.3, sourceUrl: null,
};

describe("F-401 공통점·차이점", () => {
  it("같은 축은 공통점으로 잡는다", () => {
    const { axes } = compareCase(slots, ["설명의무"], base);
    expect(axes.same.map((a) => a.label)).toEqual(["상품", "가입 경로"]);
    expect(axes.different).toHaveLength(0);
  });

  it("다른 축은 차이점으로 잡고 양쪽 값을 함께 보인다", () => {
    const { axes } = compareCase(slots, ["설명의무"], { ...base, channel: "BRANCH" });
    expect(axes.different).toHaveLength(1);
    expect(axes.different[0]).toMatchObject({ label: "가입 경로", mine: "전화(TM)", theirs: "창구·대면" });
  });

  it("조정례에 라벨이 없으면 **일치로 읽지 않는다** — 없는 공통점을 만들지 않는다", () => {
    const { axes } = compareCase(slots, ["설명의무"], { ...base, channel: null });
    expect(axes.same.map((a) => a.label)).not.toContain("가입 경로");
    expect(axes.different.map((a) => a.label)).not.toContain("가입 경로");
    expect(axes.unknown.map((a) => a.label)).toContain("가입 경로");
  });

  it("내 슬롯이 미확인이어도 일치로 읽지 않는다", () => {
    const { axes } = compareCase({ ...slots, channel: "UNKNOWN" }, ["설명의무"], base);
    expect(axes.unknown.map((a) => a.label)).toContain("가입 경로");
  });

  it("상품군이 ETC_UNKNOWN이면 견줄 수 없는 항목이다", () => {
    const { axes } = compareCase({ ...slots, product: "ETC_UNKNOWN" }, [], base);
    expect(axes.unknown.map((a) => a.label)).toContain("상품");
  });

  it("쟁점은 태그 ⊂ 문장 포함으로 대조한다", () => {
    const { issues } = compareCase(slots, ["설명의무", "적합성원칙"], {
      ...base,
      issues: ["설명의무", "약관해석"],
    });
    expect(issues.shared).toEqual(["설명의무"]);
    expect(issues.unconfirmed).toEqual(["약관해석"]);
    expect(issues.unmatchedMine).toBe(1);
  });

  it("⚠️ 내 쟁점이 문장이어도 태그를 찾아낸다 — 동등 비교는 거짓 차이를 만들었다", () => {
    // 2026.08.23 실주행 발견: judge.issues는 문장, case.issues는 태그.
    // Set 동등 비교라 설명의무 사건에서 「이 사례에만 있는 쟁점 — 설명의무」가 나왔다.
    const { issues } = compareCase(
      slots,
      ["담당직원이 투자설명서를 교부하지 않아 설명의무 이행이 확인되지 않는다"],
      { ...base, issues: ["설명의무", "과실상계"] },
    );
    expect(issues.shared).toEqual(["설명의무"]);
    // 확인 안 된 태그는 「이 사례에만 있다」가 아니라 「견줄 수 없음」으로 다룬다
    expect(issues.unconfirmed).toEqual(["과실상계"]);
  });
});

describe("유사도 표현", () => {
  it("점수·백분율을 만들지 않는다 — 도구가 준 적 없는 수치다", () => {
    const s = similaritySentence(compareCase(slots, ["설명의무"], base));
    expect(s).not.toMatch(/\d+\s*%/);
    expect(s).not.toContain("유사도");
  });

  it("겹치는 게 없으면 참고용이라고 분명히 말한다", () => {
    const s = similaritySentence(
      compareCase({ ...slots, channel: "UNKNOWN", product: "ETC_UNKNOWN" }, [], { ...base, issues: [] }),
    );
    expect(s).toContain("참고용으로만");
  });
});

describe("DR-101 조정례 요지 발췌", () => {
  it("짧은 본문은 그대로 둔다", () => {
    const r = caseExcerpt("전화로 종신보험에 가입한 사건이다.");
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("전화로 종신보험에 가입한 사건이다.");
  });

  it("긴 본문은 자르고 잘랐다고 알린다 — 원문 재현을 막는다", () => {
    const long = "신청인은 2007년 보험계약을 청약하였다. ".repeat(60); // 실측 중앙값 5,007자 수준
    const r = caseExcerpt(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(320);
  });

  it("문장 경계에서 자른다 — 중간에서 끊으면 뜻이 바뀐다", () => {
    const long = "신청인은 2007년 보험계약을 청약하였다. ".repeat(60);
    expect(caseExcerpt(long).text.endsWith("청약하였다.")).toBe(true);
  });

  it("실측 최대치(약 16,000자)도 상한 안으로 접는다", () => {
    const huge = "가".repeat(16000);
    expect(caseExcerpt(huge).text.length).toBeLessThanOrEqual(320);
  });
});

describe("한국어 조사", () => {
  it("받침 유무에 맞춰 고른다 — 「이(가)」 병기 표기를 쓰지 않는다", () => {
    expect(withParticle("가입 경로", "이", "가")).toBe("가입 경로가");
    expect(withParticle("상품", "은", "는")).toBe("상품은");
    expect(withParticle("쟁점", "과", "와")).toBe("쟁점과");
    expect(withParticle("경로", "과", "와")).toBe("경로와");
  });

  it("문장에 병기 표기가 남지 않는다", () => {
    const s = similaritySentence(compareCase(slots, ["설명의무"], { ...base, productCode: "INS_AUTO" }));
    for (const bad of ["이(가)", "은(는)", "과(와)", "을(를)"]) {
      expect(s, `문장에 ${bad}가 남아 있다`).not.toContain(bad);
    }
  });
});
