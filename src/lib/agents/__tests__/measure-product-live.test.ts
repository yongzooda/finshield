/**
 * **제품 기준 성능 측정** — 검증셋 120건 (N-601·602).
 *
 * ## 왜 다시 재나
 *
 * 공개돼 있던 수치(커버리지 70.8% · 결론 구간 정확도 83.5%)는 `pilot_law.py`
 * 실험이 만든 값이고, 그 실험은 **완결된 조정례 결정서를 넣고 위원회가 인용할지
 * 기각할지 맞히는** 과제였다. 제품은 **소비자 진술에서 정제한 사실관계를 넣고
 * 판매 과정의 법령 위반 가능성을 판단**한다. 다른 과제다.
 *
 * 실험 수치를 제품 성능으로 걸어 둔 것이 문제였고(2026.08.17 확인), 그래서
 * **제품을 그대로 재는** 측정을 새로 만든다. 실험 수치는 지우지 않는다 —
 * 당시 측정이 실제로 수행된 기록이다.
 *
 * ## 무엇을 재나
 *
 * 「유보는 설계다」를 전제로 한다. 그러면 제품의 성능은 두 가지다:
 *   · **커버리지** — 결론을 낸 비율. 낮아도 결함이 아니다
 *   · **결론 구간 정확도** — 결론을 냈을 때 맞힌 비율. 이쪽이 약속이다
 *
 * 임계가 제자리인지 보려면 4점 미만 사건이 «무엇이라고 답했을 것인가»도 있어야
 * 하므로 `judgeRaw`로 임계 적용 전 판단을 함께 기록한다 (측정 전용 경로).
 *
 * 조사 계층은 태우지 않는다 — 도구 자율 선택의 변동이 섞이면 판단 계층의
 * 성능을 못 본다. 모든 사건에 같은 조문 묶음을 준다.
 *
 * 실측 건당 45~60초 · 120건 약 2시간. **중단돼도 다시 돌리면 이어서 한다**
 * (`results-product-measure.jsonl`에 한 건씩 쌓인다).
 *
 *   PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/measure-product-live.test.ts
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "../../db";
import { judgeRaw } from "../judge";
import { lookupStatute } from "../../tools/lookup_statute";
import { Trace } from "../trace";
import { env } from "../../env";
import type { Evidence } from "../types";
import type { Slots, Verdict } from "../../types";

const live = process.env.PRECASE_LIVE === "1";

type Row = {
  decision_no: string;
  facts_summary: string;
  verdict: Verdict;
  product_code: Slots["product"] | null;
  case_year: number | null;
};

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [((c - m) / d) * 100, ((c + m) / d) * 100];
}

describe.runIf(live)("제품 기준 성능 측정", () => {
  it("검증셋 120건 — 커버리지와 결론 구간 정확도", async () => {
    const rows = await sql<Row[]>`
      select decision_no, facts_summary, verdict, product_code, case_year
      from cases
      where is_validation and facts_summary is not null
      order by decision_no`;
    console.log(`\n검증셋 ${rows.length}건 · 인용 ${rows.filter((r) => r.verdict === "UPHELD").length} · 기각 ${rows.filter((r) => r.verdict === "REJECTED").length}\n`);

    const statutes = (
      await Promise.all([
        lookupStatute({ lawName: "약관의 규제에 관한 법률", articleNo: "제3조", basisDate: "2019-01-01" }),
        lookupStatute({ lawName: "약관의 규제에 관한 법률", articleNo: "제5조", basisDate: "2019-01-01" }),
        lookupStatute({ lawName: "상법", articleNo: "제638조의3", basisDate: "2019-01-01" }),
        lookupStatute({ lawName: "상법", articleNo: "제651조", basisDate: "2019-01-01" }),
      ])
    ).filter((x): x is NonNullable<typeof x> => x !== null);

    const evidence: Evidence = {
      statutes, precedents: [], cases: [], documents: null, riskPattern: null, gaps: [],
    };

    type Rec = {
      decision_no: string; label: Verdict; pred: Verdict | null;
      conf: number | null; failure: string | null;
    };

    /**
     * ⚠️ **한 건 끝날 때마다 즉시 남긴다.**
     * 결과를 끝에 한 번에 쓰도록 짰다가 1시간 타임아웃에서 70건 가까운 판단을
     * 통째로 잃었다(2026.08.17). 두 시간짜리 측정에서 중간 저장이 없는 것은
     * 설계 결함이다 — 중단은 언제든 일어난다.
     */
    const LOG = join(process.cwd(), "results-product-measure.jsonl");

    const done0 = new Map<string, Rec>();
    if (existsSync(LOG)) {
      for (const line of readFileSync(LOG, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as Rec;
        done0.set(r.decision_no, r);
      }
      console.log(`이어하기 — 이미 끝난 ${done0.size}건은 건너뛴다\n`);
    }

    const recs: Rec[] = [];
    let apiFailures = 0;
    let consecutive = 0;

    for (const [i, r] of rows.entries()) {
      const cached = done0.get(r.decision_no);
      if (cached) { recs.push(cached); continue; }

      const slots: Slots = {
        channel: "UNKNOWN", age: "UNKNOWN",
        product: r.product_code ?? "ETC_UNKNOWN",
        contract_ym: r.case_year ? `${r.case_year}-01` : "UNKNOWN",
        traits: ["NONE"],
      };
      let j: Awaited<ReturnType<typeof judgeRaw>> = null;
      let failure: string | null = null;
      try {
        j = await judgeRaw(
          { slots, facts: { statements: [r.facts_summary], issues: [], unresolved: [] }, evidence },
          new Trace(),
        );
        if (j === null) failure = "FORMAT"; // 모델이 형식을 어겼다 — 측정 대상 사건이다
        consecutive = 0;
      } catch (e) {
        // ⚠️ **API 실패를 형식 오류로 삼키지 않는다.**
        // 앞선 측정에서 크레딧이 5건 만에 소진됐는데, 나머지 115건의 400 응답을
        // 「형식 오류」로 기록해 커버리지 0.8%라는 **가짜 수치**를 만들어냈다.
        // 측정 도구가 실패를 데이터로 둔갑시키면 그 수치가 문서로 올라간다.
        const status =
          e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : null;
        failure = `API_${typeof status === "number" ? status : "ERROR"}`;
        apiFailures += 1;
        consecutive += 1;
        if (consecutive >= 3) {
          throw new Error(
            `연속 ${consecutive}건 API 실패(${failure}) — 측정을 중단한다. ` +
              `${i + 1}/${rows.length}건 진행 후 멈춤. 부분 결과로 수치를 만들지 않는다.`,
          );
        }
      }

      const rec: Rec = {
        decision_no: r.decision_no,
        label: r.verdict,
        pred: j ? (j.conclusion === "LIKELY" ? "UPHELD" : "REJECTED") : null,
        conf: j?.confidence ?? null,
        failure,
      };
      recs.push(rec);
      appendFileSync(LOG, JSON.stringify(rec) + "\n", "utf8"); // 즉시 남긴다
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${rows.length} … (API 실패 ${apiFailures})`);
    }

    // 측정 가능 건수가 충분한지 먼저 본다 — 부족하면 수치를 만들지 않는다
    const judged = recs.filter((r) => r.conf !== null);
    const formatErrors = recs.filter((r) => r.failure === "FORMAT").length;
    expect(
      apiFailures,
      `API 실패 ${apiFailures}건 — 측정이 성립하지 않는다. 잔액·키를 확인하고 다시 돌릴 것`,
    ).toBe(0);
    expect(
      judged.length / recs.length,
      `판단이 돈 건이 ${judged.length}/${recs.length}뿐이다 — 수치를 내지 않는다`,
    ).toBeGreaterThan(0.9);

    const T = env.CONFIDENCE_THRESHOLD;
    const done = recs.filter((r) => r.conf !== null && r.conf >= T);
    const under = recs.filter((r) => r.conf !== null && r.conf < T);
    const hit = (xs: typeof recs) => xs.filter((r) => r.pred === r.label).length;

    const cov = wilson(done.length, recs.length);
    const acc = wilson(hit(done), done.length);
    const accUnder = wilson(hit(under), under.length);
    const dist: Record<number, number> = {};
    for (const r of recs) if (r.conf !== null) dist[r.conf] = (dist[r.conf] ?? 0) + 1;

    writeFileSync(
      join(process.cwd(), "results-product-measure.json"),
      JSON.stringify({ n: recs.length, threshold: T, dist, records: recs }, null, 2),
      "utf8",
    );

    console.log(
      `\n─── 제품 기준 측정 (검증셋 ${recs.length}건 · 임계 ${T}) ───\n` +
        `확신도 분포   ${[1, 2, 3, 4, 5].map((c) => `${c}:${dist[c] ?? 0}`).join("  ")}\n` +
        `커버리지      ${done.length}/${recs.length} = ${((done.length / recs.length) * 100).toFixed(1)}%  CI [${cov[0].toFixed(1)}, ${cov[1].toFixed(1)}]\n` +
        `결론 구간     ${hit(done)}/${done.length} = ${done.length ? ((hit(done) / done.length) * 100).toFixed(1) : "—"}%  CI [${acc[0].toFixed(1)}, ${acc[1].toFixed(1)}]\n` +
        `임계 미만     ${hit(under)}/${under.length} = ${under.length ? ((hit(under) / under.length) * 100).toFixed(1) : "—"}%  CI [${accUnder[0].toFixed(1)}, ${accUnder[1].toFixed(1)}]  ← 임계가 제자리인지의 근거\n` +
        `형식 오류     ${formatErrors}건 (모델이 형식을 어긴 건 — 측정 대상)\n` +
        `API 실패      ${apiFailures}건 (0이어야 측정이 성립한다)\n` +
        `\n원자료: results-product-measure.json\n`,
    );

    expect(recs.length).toBe(rows.length);
  }, 4 * 3_600_000);
});
