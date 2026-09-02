/**
 * **약관 텍스트 실험 (R-05)** — 조항 보유 32건 × 3회.
 *
 * ## 무엇을 재나
 *
 * 진술에 붙여넣은 약관 조항이 **정제 사실관계를 경유해** 판단에 닿을 때
 * 결론이 나아지는지를 잰다. 앞선 실험에서 약관 유무별 정확도가 **모델에
 * 따라 부호가 뒤집혔던** 항목이라(기획서 4.2), 현행 모델로 다시 잰다.
 *
 * ## ⚠️ 탐색적 측정이다 — 채택 근거가 아니다
 *
 * 사전 고정 기준(홀드아웃에서 정확도 비악화 −2%p 이내)은 **이 표본에서
 * 판정할 수 없다.** 약관 조항 원문이 붙은 검증셋 사건이 32/120이고
 * 홀드아웃에는 16건뿐인데, 커버리지 24%면 결론이 나는 것은 회당 서너
 * 건이라 1건이 뒤집힐 때 정확도가 20%p 넘게 움직인다. 그래서 01-scope
 * R-05를 **결과 관측 전에** 개정해 판정을 탐색적 측정으로 바꿨다.
 * 실무 귀결은 현행 유지이고, 사유는 「미달」이 아니라 「판정 불가」다.
 *
 * ## SR-402를 지키는 자리
 *
 * 약관 원문은 사용자 원문의 일부다. 그래서 `evidence`가 아니라
 * **`facts.statements`에 넣는다** — 상담 계층이 정제해 내놓은 사실 문장과
 * 같은 자리이며, 판단 계층은 여전히 원문 필드를 받지 않는다.
 *
 * ## 측정 조건
 *
 * 대조군(V0)은 `measure/consistency-measure.jsonl`의 같은 사건 3표본을
 * 쓴다 — 같은 격리(고정 조문 4종·조사 미태움·채널 UNKNOWN)라 견줄 수
 * 있다. 추가 호출 0인 대신 측정일이 다르다는 한계는 그대로다.
 *
 *   PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/measure-terms-live.test.ts
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
const K = 3;

type Row = {
  decision_no: string;
  facts_summary: string;
  verdict: Verdict;
  product_code: Slots["product"] | null;
  case_year: number | null;
  clauses: string[];
};

type Sample = { pred: Verdict; conf: number } | { pred: null; conf: null };
type Rec = { decision_no: string; label: Verdict; nClauses: number; samples: Sample[] };

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [((c - m) / d) * 100, ((c + m) / d) * 100];
}

/** 회별 커버리지 평균 + 표본 합산 정확도. 회차 수가 달라도 견줄 수 있게 한다 */
function evalSet(lines: { label: Verdict; samples: Sample[] }[], T: number) {
  const n = lines.length;
  const reps = Math.max(...lines.map((l) => l.samples.length));
  const covPerRep: number[] = [];
  for (let k = 0; k < reps; k++) {
    covPerRep.push(
      lines.filter((l) => {
        const s = l.samples[k];
        return s && s.conf !== null && s.conf >= T;
      }).length / n,
    );
  }
  let hit = 0, done = 0, fmt = 0;
  for (const l of lines)
    for (const s of l.samples) {
      if (s.conf === null) { fmt += 1; continue; }
      if (s.conf >= T) { done += 1; if (s.pred === l.label) hit += 1; }
    }
  return {
    n, reps, covPerRep,
    covMean: covPerRep.reduce((a, b) => a + b, 0) / reps,
    hit, done, fmt,
  };
}

describe.runIf(live)("약관 텍스트 실험 (R-05)", () => {
  it("조항 보유 검증셋 × 3회 — 탐색적 측정 (판정 근거 아님)", async () => {
    const T = env.CONFIDENCE_THRESHOLD;

    // 자기 사건에서 추출된 약관 조항을 가진 검증셋 사건만. 이용자가 자기
    // 약관을 붙여넣는 상황의 대응물이며, 타 사건 조항을 끌어오면 그건
    // 검색 증강(도구 경로)이지 붙여넣기 경로가 아니다
    const rows = await sql<Row[]>`
      select c.decision_no, c.facts_summary, c.verdict, c.product_code, c.case_year,
             array_agg(tc.clause_text order by length(tc.clause_text) desc) as clauses
      from cases c
      join terms_clauses tc on tc.source_case_id = c.id
      where c.is_validation and c.facts_summary is not null
      group by c.decision_no, c.facts_summary, c.verdict, c.product_code, c.case_year
      order by c.decision_no`;
    console.log(`\n조항 보유 검증셋 ${rows.length}건 × ${K}회 — 예상 호출 ${rows.length * K}건\n`);

    const baseline = new Map(
      readFileSync(join(process.cwd(), "measure/consistency-measure.jsonl"), "utf8")
        .split("\n").filter((l) => l.trim())
        .map((l) => JSON.parse(l) as { decision_no: string; label: Verdict; samples: Sample[] })
        .map((r) => [r.decision_no, r]),
    );
    for (const r of rows) {
      expect(baseline.has(r.decision_no), `V0 대조군에 ${r.decision_no}가 없다`).toBe(true);
    }

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

    const LOG = join(process.cwd(), "results-terms.jsonl");
    const done0 = new Map(
      (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter((l) => l.trim()) : [])
        .map((l) => JSON.parse(l) as Rec).map((r) => [r.decision_no, r]),
    );
    if (done0.size) console.log(`이어하기 — 이미 끝난 ${done0.size}건은 건너뛴다\n`);

    const recs: Rec[] = [];
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
      // 약관 조항을 **정제 사실관계 문장**으로 넣는다 (SR-402 — evidence가 아니다).
      // 상담 계층이 붙여넣은 약관에서 뽑아낸 사실 문장의 자리다
      const input = {
        slots,
        facts: {
          statements: [
            r.facts_summary,
            ...r.clauses.map((c) => `가입 약관에 다음 조항이 있다: ${c}`),
          ],
          issues: [],
          unresolved: [],
        },
        evidence,
      };

      let samples: Sample[];
      try {
        const js = await Promise.all(
          Array.from({ length: K }, () => judgeRaw(input, new Trace())),
        );
        samples = js.map((j) =>
          j
            ? { pred: j.conclusion === "LIKELY" ? ("UPHELD" as const) : ("REJECTED" as const), conf: j.confidence }
            : { pred: null, conf: null },
        );
        consecutive = 0;
      } catch (e) {
        const status =
          e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : null;
        consecutive += 1;
        console.log(`  ${r.decision_no} API 실패(${String(status ?? "ERROR")}) — 연속 ${consecutive}`);
        if (consecutive >= 3) {
          throw new Error(
            `연속 ${consecutive}건 API 실패 — 측정을 중단한다. ${i + 1}/${rows.length}건 진행 후 멈춤. ` +
              `${LOG}에 남긴 건은 다시 돌리면 이어서 한다.`,
          );
        }
        continue;
      }

      const rec: Rec = { decision_no: r.decision_no, label: r.verdict, nClauses: r.clauses.length, samples };
      recs.push(rec);
      appendFileSync(LOG, JSON.stringify(rec) + "\n", "utf8");
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${rows.length} …`);
    }

    expect(
      recs.length,
      `수집이 ${recs.length}/${rows.length}건 — API 실패 건을 남겨두고 수치를 만들지 않는다`,
    ).toBe(rows.length);

    // ── 집계: 같은 사건의 V0 3표본과 대조
    const nos = recs.map((r) => r.decision_no);
    const v0 = evalSet(nos.map((d) => {
      const b = baseline.get(d)!;
      return { label: b.label, samples: b.samples };
    }), T);
    const v1 = evalSet(recs.map((r) => ({ label: r.label, samples: r.samples })), T);

    const fmtLine = (name: string, s: ReturnType<typeof evalSet>) => {
      const [lo, hi] = wilson(s.hit, s.done);
      return `${name.padEnd(14)} 커버리지 [${s.covPerRep.map((c) => (c * 100).toFixed(1)).join(" ")}] 평균 ${(s.covMean * 100).toFixed(1)}%` +
        ` · 결론 구간 ${s.hit}/${s.done} = ${s.done ? ((s.hit / s.done) * 100).toFixed(1) : "—"}% CI [${lo.toFixed(1)}, ${hi.toFixed(1)}] · 형식 ${s.fmt}`;
    };

    let report =
      `\n─── 약관 실험 · 탐색적 (${recs.length}건 × ${K}회 · 임계 ${T}) ───\n` +
      `${fmtLine("V0 약관 없음", v0)}\n${fmtLine("V1 약관 주입", v1)}\n`;

    const accV0 = v0.done ? v0.hit / v0.done : 0;
    const accV1 = v1.done ? v1.hit / v1.done : 0;
    report +=
      `\n차이: 커버리지 ${((v1.covMean - v0.covMean) * 100 >= 0 ? "+" : "")}${((v1.covMean - v0.covMean) * 100).toFixed(1)}%p` +
      ` · 정확도 ${((accV1 - accV0) * 100 >= 0 ? "+" : "")}${((accV1 - accV0) * 100).toFixed(1)}%p\n`;

    // 1건이 정확도를 얼마나 움직이는지 — 이 표본에서 ±2%p 기준이 왜 해상도 아래인지의 근거
    report += `해상도: 결론 ${v1.done}건 기준 1건 뒤집힘 = ${v1.done ? (100 / v1.done).toFixed(1) : "—"}%p\n`;
    report += `\n⚠️ 탐색적 측정이다. 사전 고정 기준(±2%p)은 이 해상도에서 판정할 수 없다 —\n` +
      `   01-scope R-05 설계 개정(결과 관측 전) 참조. 실무 귀결은 현행 유지.\n`;

    writeFileSync(
      join(process.cwd(), "results-terms.json"),
      JSON.stringify({ k: K, threshold: T, n: recs.length, records: recs }, null, 2),
      "utf8",
    );
    report += `\n원자료: ${LOG}\n`;
    console.log(report);
  }, 4 * 3_600_000);
});
