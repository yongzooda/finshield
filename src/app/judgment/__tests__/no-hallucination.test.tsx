/**
 * N-405 환각 방지 자동 검증 — **도구 반환값 ↔ 화면 인용 자동 대조**.
 *
 * F-603은 「도구가 반환하지 않은 것은 화면에 렌더링되지 않는다」이고, 이 저장소는
 * 그것을 **컴포넌트 props 타입**으로 강제한다. 타입은 컴파일 시점에 지키지만
 * 두 가지를 못 잡는다:
 *
 *   1. 누군가 `string` prop을 새로 열어 모델 출력을 흘려 넣는 회귀
 *   2. 도구 반환 **객체 안의** 값이 아닌 것을 화면이 지어내는 경우
 *
 * 그래서 실제로 렌더한 HTML을 도구 반환값과 대조한다 — 화면에 나온 조문번호·
 * 사건번호·의결번호가 전부 `evidence`에 실재하는지, 그리고 `evidence`에 없는
 * 인용이 하나라도 새로 생기지 않는지.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JudgmentResult } from "../judgment-result";
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
      articleText: "보험회사는 중요 사항을 설명하여야 한다.", effectiveDate: "2011-01-24",
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
      compensationRate: 40, factsSummary: "전화로 종신보험에 가입한 사건이다.",
      issues: ["설명의무"], similarity: 0.3, sourceUrl: null,
    },
  ],
  documents: null, riskPattern: null, gaps: [],
};

/**
 * ③ 판단이 만들어낸 텍스트. **여기에 가짜 인용을 심어 둔다** —
 * 모델이 지어낸 조문·판례·사례가 화면으로 새어 나가는지 보는 것이 이 테스트의 핵심이다.
 */
const FAKE = {
  statute: "민법 제750조",
  precedent: "2099다99999",
  decision: "제2099-99호",
};

const done: JudgmentDone = {
  type: "done",
  outcome: {
    kind: "CONCLUDED",
    judgment: {
      conclusion: "LIKELY", confidence: 4, issues: ["설명의무"],
      // 판단 계층이 지어낸 인용을 reasoning에 심는다
      reasoning: `${FAKE.statute}에 따라 ${FAKE.precedent} 판례와 ${FAKE.decision} 조정례를 근거로 한다.`,
      changesIf: ["통화 녹취가 확인되는 경우"],
    },
  },
  guide: {
    headline: "위반 가능성 있음",
    // ④ 안내가 지어낸 인용도 심는다
    explanation: `설명이 부족했습니다. ${FAKE.statute} 및 ${FAKE.precedent}를 참고했습니다.`,
    changesIf: ["통화 녹취가 확인되는 경우"],
    nextSteps: [
      "이 결과와 관계없이 분쟁조정을 신청할 권리는 이용자 본인에게 있습니다.",
      "금융감독원 금융민원센터 1332로 신청하실 수 있습니다.",
    ],
    needed: [], documents: [],
    referenceCases: [FAKE.decision], // 인용 표기에도 가짜를 넣는다
    removed: 0,
  },
  evidence, slots,
  trace: [{ seq: 1, atMs: 10, layer: "INVESTIGATE", level: "INFO", message: "도구 호출 lookup_statute — OK" }],
  elapsedMs: 88000,
};

const html = renderToStaticMarkup(<JudgmentResult done={done} />);

describe("N-405 도구 반환값 ↔ 화면 인용 대조", () => {
  it("도구가 반환한 근거는 화면에 나온다", () => {
    expect(html).toContain("보험업법 제95조의2");
    expect(html).toContain("2010다76368");
    expect(html).toContain("제2019-15호");
  });

  it("⚠️ 판단·안내 계층이 지어낸 조문번호는 화면에 나오지 않는다", () => {
    expect(html, `모델이 만든 조문 「${FAKE.statute}」이 렌더됐다`).not.toContain(FAKE.statute);
  });

  it("⚠️ 지어낸 사건번호는 화면에 나오지 않는다", () => {
    expect(html, `모델이 만든 사건번호 「${FAKE.precedent}」이 렌더됐다`).not.toContain(FAKE.precedent);
  });

  it("⚠️ 지어낸 의결번호는 화면에 나오지 않는다 — referenceCases에 있어도", () => {
    expect(html, `모델이 만든 의결번호 「${FAKE.decision}」이 렌더됐다`).not.toContain(FAKE.decision);
  });

  it("화면의 인용 표기는 전부 evidence에서 온 것이다", () => {
    // 조문번호 형태(제N조/제N조의N)를 화면에서 긁어 evidence와 대조한다
    const rendered = [...html.matchAll(/제\d+조(?:의\d+)?/g)].map((m) => m[0]);
    const allowed = new Set(evidence.statutes.map((s) => s.articleNo));
    const stray = [...new Set(rendered)].filter((a) => !allowed.has(a));
    expect(stray, `evidence에 없는 조문이 렌더됐다: ${stray.join(", ")}`).toHaveLength(0);
  });

  it("근거가 비면 아무 인용도 만들어내지 않는다", () => {
    const empty = renderToStaticMarkup(
      <JudgmentResult done={{ ...done, evidence: { ...evidence, statutes: [], precedents: [], cases: [] } }} />,
    );
    expect(empty).toContain("없는 근거를 지어내지 않습니다");
    expect([...empty.matchAll(/제\d+조(?:의\d+)?/g)]).toHaveLength(0);
    expect(empty).not.toContain("2010다76368");
  });
});

describe("N-405 구조 회귀 감지", () => {
  const dir = join(process.cwd(), "src/app/judgment");

  it("근거 컴포넌트는 문자열 prop으로 인용을 받지 않는다", () => {
    // F-603의 구조적 강제가 회귀로 풀리는 가장 흔한 형태가 이것이다:
    //   <StatuteCitation text={llmOutput.statuteText} />
    const src = readFileSync(join(dir, "evidence-views.tsx"), "utf8");
    const propTypes = [...src.matchAll(/\{\s*(\w+)\s*\}:\s*\{([^}]*)\}/g)].map((m) => m[2]);
    const stringProps = propTypes.filter((t) => /:\s*string(\s*\||\s*;|\s*\})/.test(t));
    expect(
      stringProps,
      "근거 컴포넌트가 문자열 prop을 받는다 — 도구 반환 객체만 받아야 한다 (F-603):\n" +
        stringProps.join("\n"),
    ).toHaveLength(0);
  });
});
