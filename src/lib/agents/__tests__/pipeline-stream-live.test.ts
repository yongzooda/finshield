/**
 * 판단 스트리밍 실주행 — S-04가 쓸 경로를 그대로 태운다.
 *
 * `PRECASE_LIVE=1`일 때만 돈다. 재는 것은 셋이다:
 *   ① **첫 이벤트까지의 시간** — N-102 「스트리밍 시작 5초」
 *   ② **단계별·전체 소요** — N-103 「판단 P95 120초」와 Vercel 상한(300초) 대비
 *   ③ **긴 구간에 하트비트가 흐르는가** — 유휴 연결이 끊기지 않으려면 필요하다
 *
 * 상담(①)은 건너뛴다. `/api/judge`가 하는 일이 정확히 ②③④이기 때문이다 —
 * 상담 계층은 `pipeline-live.test.ts`가 따로 태운다.
 */

import { describe, expect, it } from "vitest";
import { guide } from "../guide";
import { runJudgment } from "../pipeline";
import { createSession, openSession, sealSession } from "../session";
import type { Evidence, Judgment, RefinedFacts } from "../types";
import type { Slots } from "../../types";

const live = process.env.PRECASE_LIVE === "1";

/** 실주행 시나리오와 같은 사건 — TM·67세·종신보험·2019-05·설명의무 */
const SLOTS: Slots = {
  channel: "TM",
  age: 67,
  product: "INS_WHOLE",
  contract_ym: "2019-05",
  traits: ["ELDER"],
  confirm_call: "Y",
};

const FACTS: RefinedFacts = {
  statements: [
    "2019년 5월 전화 권유로 종신보험에 가입했다",
    "가입 당시 만 67세였다",
    "원금 손실 가능성에 대한 설명을 듣지 못했다고 진술한다",
    "상품설명서를 교부받지 못했다고 진술한다",
    "사후확인콜에서는 확인 답변을 했다",
  ],
  issues: ["설명의무"],
  unresolved: ["설명 내용을 확인할 통화 녹취 보유 여부"],
};

describe.runIf(live)("판단 스트리밍 실주행", () => {
  it(
    "②③④가 스트리밍으로 끝까지 흐른다",
    async () => {
      const session = createSession();
      session.slots = SLOTS;
      session.facts = FACTS;

      const t0 = Date.now();
      const marks: { at: number; type: string; detail: string }[] = [];
      let firstEventMs: number | null = null;
      let heartbeats = 0;
      let sawDone = false;
      let doneSession: string | undefined;

      // 라우트와 같은 방식으로 봉인 콜백을 넘긴다 (F-308 확장) — done에 재봉인이 실린다
      for await (const ev of runJudgment(session, () => sealSession(session, null))) {
        const at = Date.now() - t0;
        firstEventMs ??= at;

        if (ev.type === "heartbeat") {
          heartbeats += 1;
          continue; // 표에 하트비트를 다 싣지 않는다 — 개수만 센다
        }
        marks.push({
          at,
          type: ev.type,
          detail:
            ev.type === "stage" ? ev.stage
            : ev.type === "done" ? `${ev.outcome.kind} · 근거 법령 ${ev.evidence.statutes.length}건 · 로그 ${ev.trace.length}줄`
            : ev.message,
        });
        if (ev.type === "done") {
          sawDone = true;
          doneSession = ev.session;
        }
        expect(ev.type).not.toBe("error");
      }

      const total = Date.now() - t0;

      // ① N-102 — 첫 이벤트가 5초 안에 나가야 화면이 빈 채로 있지 않는다
      expect(firstEventMs).not.toBeNull();
      expect(firstEventMs!, "첫 이벤트가 5초를 넘겼다 (N-102)").toBeLessThan(5_000);

      // ② 완주해야 한다
      expect(sawDone, "done 이벤트가 오지 않았다").toBe(true);

      // ②-b 유보 이어가기 계약 (F-308 확장) — done의 재봉인이 열리고,
      // 유보면 «필요 자료»가, 결론이면 null이 실려 있어야 한다
      expect(doneSession, "done에 재봉인 세션이 없다").toBeTruthy();
      const reopened = openSession(doneSession!);
      expect(reopened.ok, "재봉인이 열리지 않는다").toBe(true);
      if (reopened.ok) {
        if (session.outcome?.kind === "WITHHELD" && session.outcome.needed.length > 0) {
          expect(reopened.session.reentryNeeded).toEqual(session.outcome.needed);
        } else if (session.outcome?.kind === "CONCLUDED") {
          expect(reopened.session.reentryNeeded).toBeNull();
        }
        // 판단 중 소모한 도구 카운터가 승계된다 — 세션당 상한(F-607)의 정확성
        expect(reopened.session.budget.snapshot().session).toBe(session.budget.snapshot().session);
      }

      // ③ 조사 구간이 하트비트 간격보다 길면 하트비트가 있어야 한다
      if (total > 10_000) {
        expect(heartbeats, "긴 실행인데 하트비트가 없다 — 유휴 연결이 끊길 수 있다")
          .toBeGreaterThan(0);
      }

      // 사람이 읽고 판단할 표
      console.log(
        "\n─── 판단 파이프라인 실측 ───\n" +
          marks.map((m) => `${String(m.at).padStart(7)}ms  ${m.type.padEnd(6)} ${m.detail}`).join("\n") +
          `\n${String(total).padStart(7)}ms  전체 (하트비트 ${heartbeats}회)\n` +
          `예산: ${JSON.stringify(session.budget.snapshot())}\n` +
          `N-103 판단 P95 120초 대비: ${(total / 1000).toFixed(1)}초\n` +
          `Vercel Hobby 상한 300초 대비: ${((total / 300_000) * 100).toFixed(1)}% 사용\n`,
      );
    },
    600_000,
  );

  /**
   * ④ 안내는 **결론이 났을 때만** 모델을 부른다 — 유보는 코드가 만든다.
   * 위 실주행이 유보로 끝나면 ④의 모델 호출 시간이 측정에서 빠지므로,
   * **최악 경로(결론)**를 따로 잰다. 전체 상한 판단은 이 둘을 더해서 해야 한다.
   */
  it(
    "④ 안내의 모델 호출 시간 — 결론 경로의 꼬리",
    async () => {
      const session = createSession();
      const evidence: Evidence = {
        statutes: [], precedents: [], cases: [],
        documents: null, riskPattern: null, gaps: [],
      };
      const judgment: Judgment = {
        conclusion: "LIKELY",
        confidence: 4,
        issues: ["설명의무"],
        reasoning:
          "전화 권유로 가입했고 원금 손실 가능성 설명을 듣지 못했다는 진술이 있으며, " +
          "상품설명서 교부 기록이 확인되지 않는다. 가입 당시 만 67세로 이해도 확인이 더 요구되는 상황이었다.",
        changesIf: ["통화 녹취에서 손실 가능성 설명이 확인되는 경우"],
      };

      const t0 = Date.now();
      const g = await guide({ slots: SLOTS, evidence, judgment }, session.trace);
      const ms = Date.now() - t0;

      // F-306 필수 항목은 코드가 붙이므로 모델 상태와 무관하게 있어야 한다
      expect(g.nextSteps.join(" ")).toContain("1332");
      expect(g.explanation.length).toBeGreaterThan(20);

      console.log(
        `\n─── ④ 안내(결론 경로) 실측 ───\n` +
          `${String(ms).padStart(7)}ms  guide() 모델 호출\n` +
          `합산 최악 추정: 위 실주행 전체 + ${(ms / 1000).toFixed(1)}초\n`,
      );
    },
    120_000,
  );
});
