/**
 * S-04 판단 결과 렌더 검증 — **F-306의 「한 벌」 요구가 핵심이다.**
 *
 * 결론·확신도·근거·신청권·1332·판단이 달라지는 조건은 따로따로가 아니라 함께
 * 있어야 한다. 섹션 하나가 빠진 화면이 조용히 통과하면 안 되므로, 실제로
 * 렌더한 HTML에서 확인한다 (`react-dom/server` — 새 의존성 없이 된다).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JudgmentResult } from "../judgment-result";
import { paragraphs, WITHHELD_REASON_TEXTS } from "../result-views";
import { statuteAnchorId } from "@/lib/agents/citations";
import type { JudgmentDone } from "../types";
import type { Slots } from "@/lib/types";

const slots: Slots = {
  channel: "TM", age: 67, product: "INS_WHOLE",
  contract_ym: "2019-05", traits: ["ELDER"], confirm_call: "Y",
};

const evidence: JudgmentDone["evidence"] = {
  statutes: [
    {
      lawName: "보험업법", articleNo: "제95조의2", articleTitle: "설명의무 등",
      articleText: "보험회사는 ... 설명하여야 한다.", effectiveDate: "2011-01-24",
      source: "SNAPSHOT", checkedAt: "2026-08-10", transferredTo: null,
      isFallback: false, flagged: 0,
    },
  ],
  precedents: [
    { caseNo: "2010다76368", caseName: "손해배상(기)", courtName: "대법원", judgmentDate: "2011-03-24", serialNo: "1" },
  ],
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

/** ④ 안내 계층이 붙이는 고정 문구 — 실제 guide.ts가 넣는 것과 같은 형태 */
const nextSteps = [
  "가입하신 금융회사의 민원 창구에 먼저 문의해 보세요.",
  "이 결과와 관계없이 분쟁조정을 신청할 권리는 이용자 본인에게 있습니다.",
  "금융감독원 금융민원센터 1332로 상담·분쟁조정을 신청하실 수 있습니다.",
];

const concluded: JudgmentDone = {
  type: "done",
  outcome: {
    kind: "CONCLUDED",
    judgment: {
      conclusion: "LIKELY", confidence: 4, issues: ["설명의무"],
      reasoning: "설명 기록이 확인되지 않는다.",
      changesIf: ["통화 녹취에서 손실 가능성 설명이 확인되는 경우"],
    },
  },
  guide: {
    headline: "위반 가능성 있음", explanation: "설명을 들으셨다는 기록이 확인되지 않습니다.",
    changesIf: ["통화 녹취에서 손실 가능성 설명이 확인되는 경우"],
    nextSteps, needed: [], documents: [], referenceCases: ["제2019-15호"], removed: 0,
  },
  evidence, slots,
  trace: [
    { seq: 1, atMs: 10, layer: "INVESTIGATE", level: "INFO", message: "도구 호출 lookup_statute — OK" },
    { seq: 2, atMs: 20, layer: "JUDGE", level: "WARN", message: "판례 대조에 실패했습니다" },
  ],
  elapsedMs: 88000,
};

const withheld: JudgmentDone = {
  ...concluded,
  outcome: { kind: "WITHHELD", reason: "LOW_CONFIDENCE", needed: [], confidence: 3 },
  guide: {
    ...concluded.guide,
    headline: "판단을 보류했습니다",
    needed: ["가입 당시 통화 녹취", "상품설명서 교부 기록"],
  },
};

const html = (done: JudgmentDone) => renderToStaticMarkup(<JudgmentResult done={done} />);

describe("F-306 결론 상태 — 필수 항목이 한 벌로 나온다", () => {
  const out = html(concluded);

  it("① 결론과 확신도를 함께 보인다", () => {
    expect(out).toContain("위반 가능성 있음");
    expect(out).toContain("확신도 4 / 5");
  });

  it("확신도를 백분율·확률로 바꾸지 않는다 (절대 규칙 4)", () => {
    expect(out).not.toMatch(/\d+\s*%/);
    expect(out).toContain("이길 가능성을 나타내는 값이 아니며");
    expect(out).toContain("백분율로 바꿔 읽으실 수 없습니다");
  });

  it("② 쟁점과 ③ 근거 3분류가 나온다 — 전부 도구 반환값이다", () => {
    expect(out).toContain("설명의무");
    expect(out).toContain("보험업법 제95조의2");   // 법령
    expect(out).toContain("2010다76368");          // 판례 사건번호
    expect(out).toContain("제2019-15호");           // 조정례 의결번호
  });

  it("⑤ 신청권과 1332가 반드시 들어 있다", () => {
    expect(out).toContain("이용자 본인에게 있습니다");
    expect(out).toContain("1332");
  });

  it("판단이 달라지는 조건을 제시한다 (F-306 ④)", () => {
    expect(out).toContain("통화 녹취에서 손실 가능성 설명이 확인되는 경우");
  });

  it("⑥ 신고 버튼과 ⑦ 실행 로그가 있다", () => {
    expect(out).toContain("이 판단이 사실과 다릅니다");
    expect(out).toContain("도구 호출 lookup_statute");
    expect(out).toContain("판례 대조에 실패했습니다"); // 실패도 감추지 않는다
  });

  it("G-3 — 본문 상단에 면책 고지가 있다", () => {
    expect(out).toContain("법률 자문이 아닙니다");
  });

  it("배상비율을 표시하지 않는다 — 병기 불가 레이아웃이면 표시 금지 (SR-X10)", () => {
    // 픽스처의 compensationRate 40이 화면에 새어나오면 안 된다
    expect(out).not.toContain("40%");
    expect(out).not.toContain("배상비율");
  });

  it("확정 표현을 쓰지 않는다 (기획서 9.1)", () => {
    expect(out).not.toContain("배상받을 수 있습니다");
  });
});

describe("F-307 유보 상태 — 실패로 표현하지 않는다", () => {
  const out = html(withheld);

  it("① 유보 문장이 나오고 결론을 표시하지 않는다", () => {
    expect(out).toContain("지금 정보로는 판단을 유보합니다");
    expect(out).not.toContain("확신도 3 / 5"); // 임계 미만 확신도를 결론처럼 보이지 않는다
  });

  it("② 유보 사유가 실패·오류 톤이 아니다", () => {
    expect(out).toContain("한쪽으로 결론 내리기에는 이릅니다");
    expect(out).toContain("결론을 내지 못한 것이지, 신청할 수 없다는 뜻이 아닙니다");

    // ⚠️ 페이지 전체가 아니라 **유보 사유 문구**만 본다.
    // 실행 로그에는 "판례 대조에 실패했습니다" 같은 말이 있어야 한다 — 실패를
    // 감추지 않는 것이 F-402의 요구다. 두 요구를 섞어 검사하면 안 된다.
    for (const text of Object.values(WITHHELD_REASON_TEXTS)) {
      for (const bad of ["실패", "오류", "에러", "죄송", "불가"]) {
        expect(text, `유보 사유에 「${bad}」가 있다`).not.toContain(bad);
      }
    }
  });

  it("④ 유보에도 판단이 달라지는 조건이 제시된다", () => {
    expect(out).toContain("아래 자료가 확인되면 판단이 달라질 수 있습니다");
  });

  it("③ 어떤 자료가 있으면 판단 가능한지 항목으로 나눈다", () => {
    expect(out).toContain("가입 당시 통화 녹취");
    expect(out).toContain("상품설명서 교부 기록");
  });

  it("④ 재상담 경로와 1332가 함께 있다", () => {
    expect(out).toContain("자료를 보태서 다시 상담하기");
    expect(out).toContain("1332");
  });

  it("신청을 말리지 않는다 — 신청권이 명시된다", () => {
    expect(out).toContain("이용자 본인에게 있습니다");
  });
});

describe("미확인 항목을 감추지 않는다 (기획서 9.2)", () => {
  it("슬롯이 UNKNOWN이면 확인되지 않았다고 알린다", () => {
    const out = html({
      ...concluded,
      slots: { ...slots, channel: "UNKNOWN", contract_ym: "UNKNOWN" },
    });
    expect(out).toContain("확인되지 않은 항목이 2가지 있습니다");
  });

  it("근거를 못 구했으면 지어내지 않고 그렇게 적는다 (F-603)", () => {
    const out = html({
      ...concluded,
      evidence: { ...evidence, statutes: [], precedents: [], cases: [] },
    });
    expect(out).toContain("없는 근거를 지어내지 않습니다");
  });
});

describe("A11Y-7 화면 전환 알림", () => {
  it("제목이 포커스를 받을 수 있다 — 스크린리더에 전환을 알리는 지점이다", () => {
    // tabIndex={-1}: 탭 순서에는 넣지 않되 코드로는 포커스할 수 있다.
    // 없으면 화면이 바뀌어도 포커스가 이전 화면에 남아 전환이 전달되지 않는다.
    expect(html(concluded)).toMatch(/<h1[^>]*tabindex="-1"/);
    expect(html(withheld)).toMatch(/<h1[^>]*tabindex="-1"/);
  });

  it("제목이 상태에 따라 달라진다 — 같은 제목이면 알릴 것이 없다", () => {
    expect(html(concluded)).toContain("살펴본 결과입니다");
    expect(html(withheld)).toContain("지금 정보로는 판단을 유보합니다");
  });
});

describe("결론 문단 분할 — 표시만 나누고 글자는 보존한다", () => {
  it("긴 산문을 문장 경계에서 나누되 무손실이다", () => {
    const text =
      "첫 판단 근거를 살펴봤습니다. 둘째 사정이 확인됩니다. 셋째 자료가 부족합니다. " +
      "넷째 결론에 이릅니다. 다섯째 문장입니다.";
    const out = paragraphs(text);
    expect(out.length).toBe(2);
    // 다시 이어 붙이면 원문 그대로다 — 더하거나 뺀 글자가 없다
    expect(out.join(" ")).toBe(text);
  });

  it("짧은 산문은 나누지 않는다", () => {
    const text = "한 문장입니다. 두 문장입니다.";
    expect(paragraphs(text)).toEqual([text]);
  });

  it("날짜·조문 번호의 마침표에서는 자르지 않는다", () => {
    const text =
      "가입일은 2008.6.12.로 확인됩니다. 제49조 제2호가 문제됩니다. 결론은 아래와 같습니다. 추가 사정이 있습니다.";
    const out = paragraphs(text);
    expect(out.join(" ")).toBe(text);
    // 「2008.6.12.」 안에서 갈라지지 않았다면 어느 문단도 숫자로 시작하지 않는다
    for (const p of out) expect(p).not.toMatch(/^\d/);
  });
});

describe("근거 각주 — 대조된 조문만 링크된다 (각주 환각 CI)", () => {
  it("근거에 있는 조문 인용은 근거 카드 앵커로 이어지고, 착지점도 실존한다", () => {
    const cited: JudgmentDone = {
      ...concluded,
      outcome: {
        kind: "CONCLUDED",
        judgment: {
          ...(concluded.outcome as Extract<JudgmentDone["outcome"], { kind: "CONCLUDED" }>).judgment,
          issues: ["보험업법 제95조의2의 설명의무 이행 여부가 다투어진다"],
        },
      },
      guide: { ...concluded.guide, explanation: "보험업법 제95조의2 위반 소지가 확인됩니다." },
    };
    const out = html(cited);
    const anchor = statuteAnchorId("보험업법", "제95조의2");
    expect(out).toContain(`href="#${anchor}"`);
    expect(out).toContain(`id="${anchor}"`);
  });

  it("근거에 없는 조문은 화면에 남아도 링크될 수 없다", () => {
    const fake: JudgmentDone = {
      ...concluded,
      outcome: {
        kind: "CONCLUDED",
        judgment: {
          ...(concluded.outcome as Extract<JudgmentDone["outcome"], { kind: "CONCLUDED" }>).judgment,
          issues: ["민법 제750조 손해배상 책임이 문제된다"],
        },
      },
    };
    const out = html(fake);
    expect(out).toContain("민법 제750조"); // 쟁점 문장 자체는 그대로 실린다
    expect(out).not.toContain('href="#statute-'); // 그러나 어떤 근거 카드로도 이어지지 않는다
  });
});
