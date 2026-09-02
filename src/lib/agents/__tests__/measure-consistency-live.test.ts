/**
 * **자기일관성 프로토타입 측정** — 검증셋 120건 × 판단 3회 (R-04).
 *
 * ## 무엇을 확인하려는 것인가
 *
 * 재현성 실측(00-plan 10.4)에서 **확신도가 임계(4점) 근처를 넘나든 사건이
 * 22건**이었다. 흔들리는 것은 판단이 아니라 판단에 대한 자기평가다. 같은
 * 사건을 여러 번 판단시켜 확신도를 합의로 정하면 이 흔들림이 줄어드는지 —
 * 그래서 정확도를 지킨 채 커버리지가 오르는지 — 를 잰다.
 *
 * ## 왜 표본을 그대로 남기나
 *
 * 합의 규칙(중앙값·최솟값·다수결)을 지금 정하면 규칙마다 측정을 다시 돌려야
 * 한다. 건당 표본 3개를 원시 그대로 남기면 **한 번의 수집으로 모든 규칙을
 * 사후 평가**할 수 있다. 채택 판정(9/1, 01-scope R-04)은 이 원자료 위에서
 * 홀드아웃 분할로 한다 — 여기 출력되는 전체 수치는 참고이지 판정이 아니다.
 *
 * ## 측정 조건
 *
 * `measure-product-live.test.ts`와 같은 격리를 쓴다 — 조사 계층을 태우지
 * 않고 모든 사건에 같은 조문 묶음을 준다. 그래야 기존 기준선(90%/33%)과
 * 견줄 수 있다. 건당 3회는 병렬이라 벽시계 시간은 1회 측정과 같고 비용만
 * 3배다 (R-04 판정문의 C-4 관리 항목).
 *
 *   PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/measure-consistency-live.test.ts
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
};

/** 판단 1회의 결과. FORMAT은 모델이 형식을 어긴 것 — 실패가 아니라 측정 대상이다 */
type Sample = { pred: Verdict; conf: number } | { pred: null; conf: null };

type Rec = { decision_no: string; label: Verdict; samples: Sample[] };

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [((c - m) / d) * 100, ((c + m) / d) * 100];
}

/** 합의 규칙 — 원시 표본에서 (결론, 확신도) 하나를 만든다 */
type Ruled = { pred: Verdict; conf: number } | null;
type Rule = { name: string; apply: (samples: Sample[]) => Ruled };

function valid(samples: Sample[]): { pred: Verdict; conf: number }[] {
  return samples.filter((s): s is { pred: Verdict; conf: number } => s.pred !== null);
}

/** 다수 결론. 동수(1:1)면 합의 없음 — 유보 쪽으로 보낸다 */
function majority(v: { pred: Verdict; conf: number }[]): Verdict | null {
  const up = v.filter((s) => s.pred === "UPHELD").length;
  const down = v.length - up;
  if (up === down) return null;
  return up > down ? "UPHELD" : "REJECTED";
}

function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]; // 짝수면 낮은 쪽 — 확신도는 보수적으로 읽는다
}

const RULES: Rule[] = [
  {
    // 기준선 — 첫 표본 하나만 쓴다. k=1 측정과 같은 조건
    name: "단일(기준선)",
    apply: (ss) => (ss[0].pred !== null ? { pred: ss[0].pred, conf: ss[0].conf } : null),
  },
  {
    name: "다수결+중앙값",
    apply: (ss) => {
      const v = valid(ss);
      if (v.length === 0) return null;
      const m = majority(v);
      if (m === null) return null;
      return { pred: m, conf: median(v.filter((s) => s.pred === m).map((s) => s.conf)) };
    },
  },
  {
    name: "다수결+최솟값",
    apply: (ss) => {
      const v = valid(ss);
      if (v.length === 0) return null;
      const m = majority(v);
      if (m === null) return null;
      return { pred: m, conf: Math.min(...v.filter((s) => s.pred === m).map((s) => s.conf)) };
    },
  },
  {
    // 결론이 하나라도 갈리면 확신도를 임계 아래로 눌러 유보시키는 가장 엄격한 규칙
    name: "만장일치",
    apply: (ss) => {
      const v = valid(ss);
      if (v.length < K) return null;
      const first = v[0].pred;
      if (!v.every((s) => s.pred === first)) return { pred: first, conf: 1 };
      return { pred: first, conf: median(v.map((s) => s.conf)) };
    },
  },
];

describe.runIf(live)("자기일관성 프로토타입 (R-04)", () => {
  it(`검증셋 × ${K}회 — 표본 수집과 규칙별 사후 평가`, async () => {
    const rows = await sql<Row[]>`
      select decision_no, facts_summary, verdict, product_code, case_year
      from cases
      where is_validation and facts_summary is not null
      order by decision_no`;
    console.log(`\n검증셋 ${rows.length}건 × ${K}회 — 예상 호출 ${rows.length * K}건\n`);

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

    // 한 건 끝날 때마다 즉시 남긴다 — measure-product-live와 같은 이유 (70건 유실 사고)
    const LOG = join(process.cwd(), "results-consistency.jsonl");
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
      const input = {
        slots,
        facts: { statements: [r.facts_summary], issues: [], unresolved: [] },
        evidence,
      };

      // 표본 K개를 병렬로. 하나라도 API 실패면 이 건 전체를 기록하지 않는다 —
      // 부분 표본을 남기면 재개 시 그 건이 영영 2표본으로 남는다
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
        // API 실패를 데이터로 둔갑시키지 않는다 (measure-product-live의 가짜 커버리지 사고)
        const status =
          e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : null;
        consecutive += 1;
        console.log(`  ${r.decision_no} API 실패(${String(status ?? "ERROR")}) — 연속 ${consecutive}`);
        if (consecutive >= 3) {
          throw new Error(
            `연속 ${consecutive}건 API 실패 — 측정을 중단한다. ${i + 1}/${rows.length}건 진행 후 멈춤. ` +
              `이미 남긴 건은 results-consistency.jsonl에 있으니 다시 돌리면 이어서 한다.`,
          );
        }
        continue;
      }

      const rec: Rec = { decision_no: r.decision_no, label: r.verdict, samples };
      recs.push(rec);
      appendFileSync(LOG, JSON.stringify(rec) + "\n", "utf8");
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${rows.length} …`);
    }

    expect(
      recs.length,
      `수집이 ${recs.length}/${rows.length}건 — API 실패 건을 남겨두고 수치를 만들지 않는다. 다시 돌려 채울 것`,
    ).toBe(rows.length);

    // ── 사후 평가 — 전체 수치는 참고. 판정(9/1)은 홀드아웃 분할로 따로 한다
    const T = env.CONFIDENCE_THRESHOLD;

    // 표본 간 흔들림 자체를 먼저 본다 — 이 수치가 이 실험의 존재 이유다
    const withAllValid = recs.filter((r) => valid(r.samples).length === K);
    const concFlip = withAllValid.filter((r) => new Set(valid(r.samples).map((s) => s.pred)).size > 1);
    const crossT = withAllValid.filter((r) => {
      const cs = valid(r.samples).map((s) => s.conf);
      return Math.min(...cs) < T && Math.max(...cs) >= T;
    });

    let report =
      `\n─── 자기일관성 원자료 (${recs.length}건 × ${K}회 · 임계 ${T}) ───\n` +
      `결론이 표본 간 갈린 사건   ${concFlip.length}/${withAllValid.length}\n` +
      `확신도가 임계를 걸친 사건  ${crossT.length}/${withAllValid.length}  ← 기존 재현성 실측의 「22건」에 대응\n\n` +
      `규칙별 사후 평가 (전체 — 판정용 아님, 판정은 홀드아웃):\n`;

    for (const rule of RULES) {
      const ruled = recs.map((r) => ({ label: r.label, out: rule.apply(r.samples) }));
      const done = ruled.filter((x) => x.out !== null && x.out.conf >= T);
      const hit = done.filter((x) => x.out!.pred === x.label).length;
      const cov = wilson(done.length, ruled.length);
      const acc = wilson(hit, done.length);
      report +=
        `  ${rule.name.padEnd(10)} 커버리지 ${String(done.length).padStart(3)}/${ruled.length} = ${((done.length / ruled.length) * 100).toFixed(1).padStart(5)}%` +
        ` CI [${cov[0].toFixed(1)}, ${cov[1].toFixed(1)}]` +
        ` · 결론 구간 ${hit}/${done.length} = ${done.length ? ((hit / done.length) * 100).toFixed(1) : "—"}%` +
        ` CI [${acc[0].toFixed(1)}, ${acc[1].toFixed(1)}]\n`;
    }

    writeFileSync(
      join(process.cwd(), "results-consistency.json"),
      JSON.stringify({ k: K, threshold: T, n: recs.length, records: recs }, null, 2),
      "utf8",
    );
    report += `\n원자료: results-consistency.json / results-consistency.jsonl\n`;
    console.log(report);
  }, 4 * 3_600_000);
});
