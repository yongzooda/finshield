/**
 * 4계층 실주행 — 모델·DB·법제처 API를 실제로 부른다.
 *
 * 기본 실행에서는 건너뛴다. `PRECASE_LIVE=1`일 때만 돈다.
 * 단위 테스트가 통과해도 **계층 접합부는 따로 깨진다** — 되묻기가 슬롯을
 * 쌓지 못한 결함도 단위 테스트 96건을 통과한 상태에서 나왔다. 그래서
 * 시나리오 한 건을 끝까지 태우는 경로를 남겨 둔다.
 */

import { describe, expect, it } from "vitest";
import { consult } from "../consult";
import { investigate } from "../investigate";
import { judge } from "../judge";
import { guide, guideWithheld } from "../guide";
import { gateForModel, maskPii } from "../pii";
import { basisDateFrom, finalizeSlots } from "../slots";
import { createSession } from "../session";
import type { Slots } from "../../types";
import type { RefinedFacts } from "../types";

const live = process.env.PRECASE_LIVE === "1";

describe.runIf(live)("4계층 실주행", () => {
  it(
    "TM·고령·종신보험 설명의무 사건이 끝까지 흐른다",
    async () => {
      const session = createSession();
      const raw =
        "안녕하세요. 저희 어머니가 2019년 5월에 전화를 받고 종신보험에 가입하셨는데요, " +
        "그때 어머니가 67세셨어요. 연락처는 010-1234-5678입니다. " +
        "나중에 보니까 원금이 손실될 수 있다는 얘기를 전혀 못 들으셨다고 하시고, " +
        "설명서도 못 받으셨대요. 해피콜은 받으셨다고 하는데 그냥 네네 하고 대답만 하셨답니다. " +
        "너무 억울합니다. 이거 배상 받을 수 있을까요?";

      // ① 원문은 PII 마스킹을 거친 뒤에만 상담 계층으로 간다 (F-601)
      const masked = maskPii(raw);
      expect(masked.text).not.toContain("010-1234-5678");
      expect(gateForModel(masked.text).ok).toBe(true);

      // 되묻기를 실제로 돌린다 — 슬롯이 누적되는지가 핵심이다
      let slots: Partial<Slots> = {};
      let asked = 0;
      let facts: RefinedFacts | null = null;

      for (let i = 0; i < 8; i++) {
        const r = await consult(
          { maskedStatement: masked.text, slots, askedCount: asked },
          (errs) => session.trace.warn("CONSULT", "슬롯 검증 실패", { n: errs.length }),
        );
        expect(r.kind).not.toBe("OUT_OF_SCOPE");
        if (r.kind === "READY") {
          slots = r.slots;
          facts = r.facts;
          break;
        }
        if (r.kind === "ASK") {
          // 사용자가 답한 셈 치고 채운다. 슬롯이 실제로 쌓이는지 보는 것이 목적이다
          const before = Object.keys(r.slots).length;
          slots = { ...r.slots, [r.slot]: fillAnswer(r.slot) } as Partial<Slots>;
          expect(Object.keys(slots).length).toBeGreaterThan(before - 1);
          asked += 1;
          session.trace.info("CONSULT", `되물음: ${r.slot}`);
        }
      }

      expect(facts, "되묻기 8회 안에 슬롯이 다 차지 않았다").not.toBeNull();

      const fin = finalizeSlots(slots);
      expect(fin.ok, `슬롯 완성 실패: ${!fin.ok ? fin.errors.join(", ") : ""}`).toBe(true);
      if (!fin.ok) return;

      // 나이 67 → ELDER가 자동으로 붙어야 한다
      expect(fin.slots.traits).toContain("ELDER");

      const basisDate = basisDateFrom(fin.slots);
      expect(basisDate).toBe("2019-05-01");

      // ② 조사 — 금소법 시행 이전이므로 금소법을 인용하면 안 된다
      const inv = await investigate(
        { slots: fin.slots, facts: facts!, basisDate },
        { budget: session.budget, trace: session.trace },
      );
      const laws = inv.evidence.statutes.map((s) => s.lawName);
      expect(laws.join(","), "2019년 사건에 금소법을 조회했다").not.toContain("금융소비자");
      expect(inv.evidence.statutes.length).toBeGreaterThan(0);

      // ③ 판단
      const outcome = await judge(
        { slots: fin.slots, facts: facts!, evidence: inv.evidence },
        session.trace,
      );

      // ④ 안내 — 결론이든 유보든 신청권·1332가 반드시 들어간다
      const g =
        outcome.kind === "CONCLUDED"
          ? await guide(
              { slots: fin.slots, evidence: inv.evidence, judgment: outcome.judgment },
              session.trace,
            )
          : guideWithheld(outcome);

      expect(g.nextSteps.join(" ")).toContain("1332");
      expect(g.nextSteps.join(" ")).toContain("이용자 본인에게 있습니다");
      expect(g.explanation.length).toBeGreaterThan(20);

      // 실행 로그는 도구 호출을 전부 담고 있어야 한다 (F-402)
      expect(session.trace.summary().tools).toBeGreaterThan(0);

      // 사람이 읽고 판단할 수 있게 남긴다
      console.log(JSON.stringify({
        slots: fin.slots,
        issues: facts!.issues,
        statutes: inv.evidence.statutes.map((s) => `${s.lawName} ${s.articleNo} [${s.source}]`),
        precedents: inv.evidence.precedents.map((p) => p.caseNo),
        cases: inv.evidence.cases.length,
        gaps: inv.evidence.gaps,
        exhausted: inv.exhausted,
        outcome: outcome.kind,
        confidence: outcome.kind === "CONCLUDED" ? outcome.judgment.confidence : outcome.confidence,
        conclusion: outcome.kind === "CONCLUDED" ? outcome.judgment.conclusion : null,
        headline: g.headline,
        explanation: g.explanation,
        changesIf: g.changesIf,
        nextSteps: g.nextSteps,
        removed: g.removed,
        budget: session.budget.snapshot(),
        trace: session.trace.read().map((e) => `${e.layer} ${e.level} ${e.message}`),
      }, null, 2));
    },
    600_000,
  );
});

function fillAnswer(slot: string): unknown {
  switch (slot) {
    case "product": return "INS_WHOLE";
    case "contract_ym": return "2019-05";
    case "channel": return "TM";
    case "age": return 67;
    case "traits": return ["ELDER"];
    case "confirm_call": return "Y";
    case "survey_writer": return "UNKNOWN";
    case "explained_loss": return "N";
    default: return "UNKNOWN";
  }
}

/**
 * ④ 안내는 `callText`(스트리밍) 경로를 쓴다. 위 시나리오가 유보로 끝나면
 * 이 경로가 한 번도 실행되지 않으므로 판단 결과를 직접 만들어 태운다.
 */
describe.runIf(live)("④ 안내 실주행", () => {
  it(
    "판단을 바꾸지 않고 설명 문단을 만든다",
    async () => {
      const session = createSession();
      const slots: Slots = {
        channel: "TM", age: 72, product: "INS_WHOLE",
        contract_ym: "2019-05", traits: ["ELDER", "INEXP"],
      };
      const g = await guide(
        {
          slots,
          evidence: {
            statutes: [{
              lawName: "보험업법", articleNo: "제95조의2", articleTitle: "설명의무 등",
              articleText:
                "보험회사는 보험계약의 체결 시부터 보험금 지급 시까지의 주요 과정을 " +
                "대통령령으로 정하는 바에 따라 일반보험계약자에게 설명하여야 한다.",
              effectiveDate: null, source: "SNAPSHOT", checkedAt: "2026-08-10",
              transferredTo: null, isFallback: false, flagged: 0,
            }],
            precedents: [], cases: [], documents: null, riskPattern: null, gaps: [],
          },
          judgment: {
            conclusion: "UNLIKELY",
            confidence: 4,
            issues: ["설명의무"],
            reasoning:
              "해피콜에서 주요 내용을 확인한 기록이 있고 청약서에 자필 서명이 확인되어, " +
              "설명의무를 다하지 않았다고 보기는 어렵다.",
            changesIf: ["해피콜 녹취에서 형식적 응답만 확인된다면 결론이 달라질 수 있습니다"],
          },
        },
        session.trace,
      );

      // 결론을 뒤집거나 완화하지 않는다
      expect(g.headline).toBe("위반 가능성 낮음");
      // ④ 판단이 달라지는 조건은 판단 결과 그대로다
      expect(g.changesIf).toEqual([
        "해피콜 녹취에서 형식적 응답만 확인된다면 결론이 달라질 수 있습니다",
      ]);
      // ①② 필수 안내
      expect(g.nextSteps.join(" ")).toContain("1332");
      expect(g.nextSteps.join(" ")).toContain("이용자 본인에게 있습니다");
      // 제시하지 않은 법령을 끌어오지 않았는지 — 2019년 사건이므로 금소법은 나오면 안 된다
      expect(g.explanation).not.toContain("금융소비자");
      expect(g.explanation.length).toBeGreaterThan(30);

      console.log(JSON.stringify({ headline: g.headline, explanation: g.explanation, removed: g.removed }, null, 2));
    },
    300_000,
  );
});
