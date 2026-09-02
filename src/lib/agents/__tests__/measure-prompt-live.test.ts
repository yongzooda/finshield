/**
 * **확신도 루브릭 본실험** — 훈련 60건 × 변형 3종 × 2회 (D-7 · R-04 파생).
 *
 * ## 무엇을 확인하려는 것인가
 *
 * R-04(자기일관성 합의)는 기각됐다 — 합의는 커버리지를 깎는 방향으로만
 * 작동했다. 남은 지렛대는 확신도 지시문 자체다. 현행 지시는 한 줄이고
 * 하향 앵커만 있다(「결론이 불확실하면 낮게 매긴다」). 2026.08.17의 5단계
 * 루브릭 붕괴(judge.ts 상단 주석)는 «루브릭 일반»의 실패가 아니라 «하향
 * 편향 루브릭»의 실패였다는 가설을, 성격이 다른 변형 3종으로 잰다:
 *
 *   V1 양끝 앵커   — 4점에 양성 정의를 준다 (반대 결론에 새 사실이 필요하면 4)
 *   V2 위원회 합치 — 확신도를 채점 대상 사건(위원회가 같은 결론에 이를
 *                    가능성)에 앵커한다
 *   V3 반대결론 판별 — 척도 서술 대신 판별 절차 한 가지만 준다
 *
 * ## 사전 고정
 *
 * 분할·선발·판정 기준은 실행 전에 01-scope 9.1 R-04 행에 고정했다
 * (2026.08.30). 이 러너는 그 절차의 구현이며 수치 해석을 임의로 바꾸지
 * 않는다. 문안 정본·설계 기록은 `measure/prompt-measure.md`.
 *
 * V0 기준선은 R-04 원자료(`measure/consistency-measure.jsonl` — 같은 격리
 * 조건, 120건 × 표본 3개)를 분할별로 재계산해 쓴다. 추가 호출이 없는
 * 대신 측정일이 다르다는 한계를 기록으로 남긴다.
 *
 * ## 측정 조건
 *
 * measure-product-live · measure-consistency-live와 같은 격리 — 조사 계층을
 * 태우지 않고 모든 사건에 같은 조문 4종을 준다. 그래야 V0과 견줄 수 있다.
 *
 *   훈련:     PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/measure-prompt-live.test.ts
 *   홀드아웃: PRECASE_LIVE=1 PRECASE_PHASE=holdout PRECASE_VARIANT=V2 npx vitest run (같은 파일)
 *   스모크:   PRECASE_LIVE=1 PRECASE_SMOKE=1 …  — 훈련 앞 2건, 별도 로그. 하네스 점검용
 *
 * 홀드아웃 모드는 훈련 로그에서 선발을 **재계산**해, 넘긴 변형이 선발
 * 결과와 다르면 거부한다 — 통과 변형을 골라 바꿔 태우는 경로를 막는다.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "../../db";
import { buildJudgeSystemWithRubric, judgeRaw } from "../judge";
import { lookupStatute } from "../../tools/lookup_statute";
import { Trace } from "../trace";
import { env } from "../../env";
import type { Evidence } from "../types";
import type { Slots, Verdict } from "../../types";

const live = process.env.PRECASE_LIVE === "1";
const K = 2;

// ── 변형 문안 — 정본. 문서(prompt-measure.md)는 이걸 인용한다 ──────────────
const VARIANTS = [
  {
    id: "V1",
    name: "양끝 앵커",
    rubric: `## 확신도 (1~5 정수)
당신이 이 결론을 얼마나 확신하는지 스스로 매긴다.
- 5: 제시된 근거와 원칙만으로 결론이 명확하다. 반대 결론을 지지하는 사실이 기록에 없다.
- 4: 결론이 선다. 반대 결론이 성립하려면 현재 기록에 없는 새로운 사실이 필요하다.
- 3: 현재 기록의 공백이나 상충만으로도 결론이 뒤집힐 수 있다.
- 1~2: 근거가 부족해 어느 쪽으로도 판단하기 어렵다.
결론이 불확실하면 확신도를 낮게 매긴다. 억지로 확신하지 마라.`,
  },
  {
    id: "V2",
    name: "위원회 합치",
    rubric: `## 확신도 (1~5 정수)
확신도는 「같은 사실관계와 같은 근거를 본 분쟁조정위원회가 당신과 같은 결론에 이를 가능성」에 대한 당신의 평가다.
- 5: 위원회가 다른 결론에 이를 여지가 거의 없다.
- 4: 위원회도 같은 결론에 이를 것으로 본다.
- 3 이하: 위원회가 다른 결론에 이를 수 있다.
결론이 불확실하면 확신도를 낮게 매긴다. 억지로 확신하지 마라.`,
  },
  {
    id: "V3",
    name: "반대결론 판별",
    rubric: `## 확신도 (1~5 정수)
당신이 이 결론을 얼마나 확신하는지 스스로 매긴다.
매기기 전에 반대 결론이 성립하는 가장 강한 경로를 세워 보라.
- 그 경로에 현재 기록에 없는 새로운 사실이 필요하다면: 4 이상.
- 그 경로가 현재 기록의 공백·상충만으로 성립한다면: 3 이하.
억지로 확신하지 마라.`,
  },
] as const;

type VariantId = (typeof VARIANTS)[number]["id"];

type Row = {
  decision_no: string;
  facts_summary: string;
  verdict: Verdict;
  product_code: Slots["product"] | null;
  case_year: number | null;
};

type Sample = { pred: Verdict; conf: number } | { pred: null; conf: null };
type Rec = { decision_no: string; variant: VariantId; label: Verdict; samples: Sample[] };
type Line = { label: Verdict; samples: Sample[] };

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [((c - m) / d) * 100, ((c + m) / d) * 100];
}

/**
 * 한 (변형 × 분할)의 집계. 커버리지는 회별로 재고 평균한다 — 합산으로 재면
 * 회차 수가 다른 V0(3표본)과 변형(2회)을 견줄 수 없다. 임계 걸침은 사전
 * 고정대로 **앞 2회만** 본다 (V0도 첫 2표본).
 */
function evalSet(lines: Line[], T: number) {
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
  const covMean = covPerRep.reduce((a, b) => a + b, 0) / reps;
  let hit = 0, done = 0, fmt = 0, total = 0;
  for (const l of lines)
    for (const s of l.samples) {
      total += 1;
      if (s.conf === null) { fmt += 1; continue; }
      if (s.conf >= T) { done += 1; if (s.pred === l.label) hit += 1; }
    }
  const crossing = lines.filter((l) => {
    const cs = l.samples.slice(0, 2);
    if (cs.length < 2 || cs.some((s) => s.conf === null)) return false;
    const vals = cs.map((s) => s.conf as number);
    return Math.min(...vals) < T && Math.max(...vals) >= T;
  }).length;
  return { n, reps, covPerRep, covMean, hit, done, fmt, total, crossing };
}

type SetStats = ReturnType<typeof evalSet>;

/** 사전 고정 기준 ⓐⓑⓒ(=①②③). 순서·문구는 01-scope R-04 행과 같다 */
function gates(v: SetStats, v0: SetStats) {
  const acc = v.done ? v.hit / v.done : 0;
  return {
    a: acc >= 0.85,
    b: v.covMean >= v0.covMean + 0.05,
    c: v.crossing <= v0.crossing,
    acc,
    gain: v.covMean - v0.covMean,
    pass: false as boolean,
  };
}

function fmtStats(s: SetStats, v0?: SetStats): string {
  const covs = s.covPerRep.map((c) => (c * 100).toFixed(1)).join(" ");
  const acc = s.done ? ((s.hit / s.done) * 100).toFixed(1) : "—";
  const [alo, ahi] = wilson(s.hit, s.done);
  const gain = v0 ? ` (이득 ${((s.covMean - v0.covMean) * 100 >= 0 ? "+" : "")}${((s.covMean - v0.covMean) * 100).toFixed(1)}%p)` : "";
  return (
    `커버리지 [${covs}] 평균 ${(s.covMean * 100).toFixed(1)}%${gain}` +
    ` · 결론 구간 ${s.hit}/${s.done} = ${acc}% CI [${alo.toFixed(1)}, ${ahi.toFixed(1)}]` +
    ` · 임계 걸침 ${s.crossing} · 형식 ${s.fmt}/${s.total}`
  );
}

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

/** 훈련 로그에서 사전 고정 선발 규칙을 재계산한다 (이득 → 정확도 → id 순 결정적) */
function selectFromTrain(
  trainRecs: Rec[],
  v0Train: SetStats,
  T: number,
): { id: VariantId; g: ReturnType<typeof gates> } | null {
  const passing: { id: VariantId; g: ReturnType<typeof gates> }[] = [];
  for (const v of VARIANTS) {
    const lines = trainRecs.filter((r) => r.variant === v.id).map((r) => ({ label: r.label, samples: r.samples }));
    if (lines.length === 0) continue;
    const g = gates(evalSet(lines, T), v0Train);
    g.pass = g.a && g.b && g.c;
    if (g.pass) passing.push({ id: v.id, g });
  }
  passing.sort((x, y) => y.g.gain - x.g.gain || y.g.acc - x.g.acc || (x.id < y.id ? -1 : 1));
  return passing[0] ?? null;
}

describe.runIf(live)("확신도 루브릭 본실험 (R-04 파생)", () => {
  it("훈련 선발 → 홀드아웃 판정 — 01-scope 사전 고정 절차", async () => {
    const phase = process.env.PRECASE_PHASE === "holdout" ? "holdout" : "train";
    const smoke = process.env.PRECASE_SMOKE === "1";
    const T = env.CONFIDENCE_THRESHOLD;

    // ── 분할·검증셋·기준선 로드, 정합 검증 ─────────────────────────────
    const split = JSON.parse(readFileSync(join(process.cwd(), "measure/prompt-split.json"), "utf8")) as {
      train: string[]; holdout: string[];
    };
    const rows = await sql<Row[]>`
      select decision_no, facts_summary, verdict, product_code, case_year
      from cases
      where is_validation and facts_summary is not null
      order by decision_no`;
    const byNo = new Map(rows.map((r) => [r.decision_no, r]));
    const all = [...split.train, ...split.holdout];
    expect(new Set(all).size, "분할에 중복이 있다").toBe(all.length);
    expect(all.length, "분할과 검증셋 크기가 다르다 — make_prompt_split.mjs 재생성 필요").toBe(rows.length);
    for (const d of all) expect(byNo.has(d), `분할의 ${d}가 검증셋에 없다`).toBe(true);

    const baseline = new Map(
      loadJsonl<{ decision_no: string; label: Verdict; samples: Sample[] }>(
        join(process.cwd(), "measure/consistency-measure.jsonl"),
      ).map((r) => [r.decision_no, r]),
    );
    for (const d of all) expect(baseline.has(d), `V0 기준선에 ${d}가 없다`).toBe(true);

    const v0Of = (nos: string[]) =>
      evalSet(nos.map((d) => ({ label: baseline.get(d)!.label, samples: baseline.get(d)!.samples })), T);
    const v0Train = v0Of(split.train);

    // ── 홀드아웃 모드 진입 조건 — 선발 재계산으로 강제 ─────────────────
    const TRAIN_LOG = join(process.cwd(), "results-prompt-train.jsonl");
    let holdoutVariant: (typeof VARIANTS)[number] | null = null;
    if (phase === "holdout") {
      const trainRecs = loadJsonl<Rec>(TRAIN_LOG);
      expect(
        trainRecs.length,
        `훈련 로그가 ${trainRecs.length}건 — ${split.train.length * VARIANTS.length}건 완료 전에는 홀드아웃을 열지 않는다`,
      ).toBe(split.train.length * VARIANTS.length);
      const sel = selectFromTrain(trainRecs, v0Train, T);
      expect(sel, "훈련 게이트 통과 변형이 없다 — 홀드아웃 미개봉 · 자동 기각 (01-scope)").toBeTruthy();
      const envV = process.env.PRECASE_VARIANT;
      expect(envV, `PRECASE_VARIANT 미지정 — 훈련 선발은 ${sel!.id}`).toBe(sel!.id);
      holdoutVariant = VARIANTS.find((v) => v.id === sel!.id)!;
      console.log(`\n홀드아웃 진출 변형: ${sel!.id} (훈련 이득 ${(sel!.g.gain * 100).toFixed(1)}%p · 정확도 ${(sel!.g.acc * 100).toFixed(1)}%)\n`);
    }

    const caseNos = smoke ? split.train.slice(0, 2) : split[phase];
    const variants = phase === "train" ? [...VARIANTS] : [holdoutVariant!];
    const systems = new Map(variants.map((v) => [v.id, buildJudgeSystemWithRubric(v.rubric)]));
    console.log(
      `\n${phase}${smoke ? " (스모크)" : ""} — ${caseNos.length}건 × ${variants.length}변형 × ${K}회 = 호출 ${caseNos.length * variants.length * K}건\n`,
    );

    // 격리 조건 — product·consistency 측정과 동일한 고정 조문 4종
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

    // ── 수집 — (사건 × 변형) 단위로 원자적 기록, 이어하기 지원 ─────────
    const LOG = join(
      process.cwd(),
      smoke ? "results-prompt-smoke.jsonl" : `results-prompt-${phase}.jsonl`,
    );
    const done0 = new Map(loadJsonl<Rec>(LOG).map((r) => [`${r.decision_no}::${r.variant}`, r]));
    if (done0.size) console.log(`이어하기 — 이미 끝난 ${done0.size}쌍은 건너뛴다\n`);

    const recs: Rec[] = [...done0.values()];
    let consecutive = 0;

    for (const [i, no] of caseNos.entries()) {
      const r = byNo.get(no)!;
      const missing = variants.filter((v) => !done0.has(`${no}::${v.id}`));
      if (missing.length === 0) continue;

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

      // 변형별 2회가 한 단위다. 한 회라도 API 실패면 그 변형만 버리고 다음에
      // 다시 — 부분 표본을 남기면 그 쌍이 영영 1회짜리로 남는다 (R-04와 동일)
      const settled = await Promise.allSettled(
        missing.map(async (v) => {
          const js = await Promise.all(
            Array.from({ length: K }, () => judgeRaw(input, new Trace(), systems.get(v.id)!)),
          );
          const samples: Sample[] = js.map((j) =>
            j
              ? { pred: j.conclusion === "LIKELY" ? ("UPHELD" as const) : ("REJECTED" as const), conf: j.confidence }
              : { pred: null, conf: null },
          );
          return { v, samples };
        }),
      );

      for (const s of settled) {
        if (s.status === "fulfilled") {
          const rec: Rec = { decision_no: no, variant: s.value.v.id, label: r.verdict, samples: s.value.samples };
          recs.push(rec);
          done0.set(`${no}::${rec.variant}`, rec);
          appendFileSync(LOG, JSON.stringify(rec) + "\n", "utf8");
          consecutive = 0;
        } else {
          // API 실패를 데이터로 둔갑시키지 않는다 (measure-product-live의 사고)
          const e: unknown = s.reason;
          const status =
            e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : null;
          consecutive += 1;
          console.log(`  ${no} API 실패(${String(status ?? "ERROR")}) — 연속 ${consecutive}`);
          if (consecutive >= 3) {
            throw new Error(
              `연속 ${consecutive}쌍 API 실패 — 크레딧 소진 가능성. 측정을 중단한다. ` +
                `${i + 1}/${caseNos.length}건 진행 후 멈춤. ${LOG}에 남긴 쌍은 다시 돌리면 이어서 한다.`,
            );
          }
        }
      }
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${caseNos.length} …`);
    }

    expect(
      recs.length,
      `수집이 ${recs.length}/${caseNos.length * variants.length}쌍 — API 실패 쌍을 남겨두고 수치를 만들지 않는다. 다시 돌려 채울 것`,
    ).toBe(caseNos.length * variants.length);

    // ── 집계·판정 출력 ─────────────────────────────────────────────────
    const v0Side = phase === "train" || smoke ? v0Of(caseNos) : v0Of(split.holdout);
    let report = `\n─── 루브릭 본실험 · ${phase}${smoke ? "(스모크)" : ""} (${caseNos.length}건 × ${K}회 · 임계 ${T}) ───\n`;
    report += `V0 기준선(R-04 원자료 3표본)  ${fmtStats(v0Side)}\n`;

    const perVariant = new Map<VariantId, SetStats>();
    for (const v of variants) {
      const lines = recs
        .filter((r) => r.variant === v.id && caseNos.includes(r.decision_no))
        .map((r) => ({ label: r.label, samples: r.samples }));
      const st = evalSet(lines, T);
      perVariant.set(v.id, st);
      const g = gates(st, v0Side);
      report += `${v.id} ${v.name.padEnd(7)}  ${fmtStats(st, v0Side)}\n`;
      report += `   기준 ${phase === "train" ? "ⓐⓑⓒ" : "①②③"}: 정확도≥85% ${g.a ? "충족" : "미달"} · 커버리지+5%p ${g.b ? "충족" : "미달"} · 걸침 비악화 ${g.c ? "충족" : "미달"}\n`;

      // 진단 — 신규 커버 사건(V0 3표본 전부 임계 미만)에서의 명중률
      const fresh = recs.filter((r) => {
        if (r.variant !== v.id || !caseNos.includes(r.decision_no)) return false;
        const b = baseline.get(r.decision_no)!;
        return b.samples.every((sm) => sm.conf === null || sm.conf < T) &&
          r.samples.some((sm) => sm.conf !== null && sm.conf >= T);
      });
      const freshHit = fresh.reduce(
        (acc, r) => acc + r.samples.filter((sm) => sm.conf !== null && sm.conf >= T && sm.pred === r.label).length,
        0,
      );
      const freshDone = fresh.reduce(
        (acc, r) => acc + r.samples.filter((sm) => sm.conf !== null && sm.conf >= T).length,
        0,
      );
      report += `   신규 커버 ${fresh.length}건 — 그 결론 구간 ${freshHit}/${freshDone}\n`;
    }

    if (phase === "train" && !smoke) {
      const sel = selectFromTrain(recs, v0Train, T);
      report += sel
        ? `\n선발: ${sel.id} (이득 ${(sel.g.gain * 100).toFixed(1)}%p · 정확도 ${(sel.g.acc * 100).toFixed(1)}%)` +
          ` → 홀드아웃 진출. 다음: PRECASE_PHASE=holdout PRECASE_VARIANT=${sel.id}\n`
        : `\n선발 없음 — 홀드아웃 미개봉 · 자동 기각 (01-scope 사전 고정)\n`;
    }
    if (phase === "holdout") {
      const v = variants[0];
      const g = gates(perVariant.get(v.id)!, v0Side);
      report += `\n판정: ${g.a && g.b && g.c ? `채택 — ${v.id} ${v.name}. 확신도 절 교체 → 9/2 공식 런으로 전면 재측정` : "기각 — 현행 유지 (하나라도 미달 시 자동 기각)"}\n`;
    }

    writeFileSync(
      join(process.cwd(), smoke ? "results-prompt-smoke.json" : `results-prompt-${phase}.json`),
      JSON.stringify({ phase, k: K, threshold: T, n: caseNos.length, records: recs }, null, 2),
      "utf8",
    );
    report += `\n원자료: ${LOG}\n`;
    console.log(report);
  }, 4 * 3_600_000);
});
