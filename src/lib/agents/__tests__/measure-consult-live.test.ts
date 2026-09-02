/**
 * **① 상담 계층 성능 측정** — 슬롯 추출 (F-301 · F-605).
 *
 * 공개 수치는 판단 계층만 잰 값이라 이 구간이 비어 있었다. 배경과 한계는
 * `consult-fixtures.ts` 머리말에 적었다.
 *
 * ## 세 가지를 따로 센다
 *
 *   · **오분류** — 단서가 있는데 다른 값. 엉뚱한 비교군을 끌어온다
 *   · **누락**   — 단서가 있는데 비움. 되묻기로 회복되므로 덜 해롭다
 *   · **날조**   — 단서가 없는데 특정 값. 가장 해롭고, 이 프로젝트의 약속과 직결된다
 *
 * 하나로 뭉친 「정확도」만 내면 성격이 다른 셋이 섞여 무엇을 고쳐야 할지 알 수 없다.
 *
 * ## 실행
 *
 *   PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/measure-consult-live.test.ts --disable-console-intercept
 *
 * 건당 3~6초 · 43건 약 4분. 중단돼도 다시 돌리면 이어서 한다
 * (`results-consult-measure.jsonl`에 한 건씩 쌓인다).
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consult } from "../consult";
import { CONSULT_CASES, REALISTIC_CASES, type ConsultCase } from "./consult-fixtures";
import type { Slots } from "../../types";

const live = process.env.PRECASE_LIVE === "1";

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  // 하한이 -0.0으로 찍히는 것을 막는다 — 공개되는 수치다
  return [Math.max(0, ((c - m) / d) * 100), Math.min(100, ((c + m) / d) * 100)];
}

/** 비어 있음 = 키 부재 또는 명시적 UNKNOWN. 둘 다 「채우지 않았다」로 본다. */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "UNKNOWN";
}

type SlotKey = "channel" | "age" | "product" | "contract_ym";
type Mark = "정확" | "오분류" | "누락" | "날조" | "정상비움";

type Rec = {
  id: string;
  outOfScope: boolean;
  /** 슬롯별 판정 */
  marks: { slot: string; mark: Mark; want?: string; got?: string }[];
  failure: string | null;
};

function score(c: ConsultCase, slots: Partial<Slots>): Rec["marks"] {
  const marks: Rec["marks"] = [];

  for (const [slot, want] of Object.entries(c.expect ?? {})) {
    if (slot === "traits") {
      const got = (slots.traits ?? []) as string[];
      // 기대한 특성이 전부 들어 있으면 정확. ELDER는 나이에서 파생되므로 추가돼도 벌하지 않는다.
      const missing = (want as readonly string[]).filter((t) => !got.includes(t));
      marks.push({
        slot: "traits",
        mark: missing.length === 0 ? "정확" : got.length === 0 ? "누락" : "오분류",
        want: (want as readonly string[]).join(","),
        got: got.join(",") || "(빔)",
      });
      continue;
    }
    const got = slots[slot as SlotKey];
    const mark: Mark = isEmpty(got) ? "누락" : String(got) === String(want) ? "정확" : "오분류";
    marks.push({ slot, mark, want: String(want), got: isEmpty(got) ? "(빔)" : String(got) });
  }

  for (const slot of c.absent ?? []) {
    const got = slots[slot];
    marks.push({
      slot,
      mark: isEmpty(got) ? "정상비움" : "날조",
      want: "(비어야 함)",
      got: isEmpty(got) ? "(빔)" : String(got),
    });
  }
  return marks;
}

/** 세트별로 따로 집계한다 — 실전형(R-08)이 기본 세트보다 어려운지가 관심사다 */
const SETS: readonly { name: string; cases: readonly ConsultCase[] }[] = [
  { name: "기본", cases: CONSULT_CASES },
  { name: "실전형", cases: REALISTIC_CASES },
];
const ALL_CASES: readonly ConsultCase[] = SETS.flatMap((s) => s.cases);

describe.runIf(live)("상담 계층 슬롯 추출 측정", () => {
  it(`진술 ${ALL_CASES.length}건 (기본 ${CONSULT_CASES.length} + 실전형 ${REALISTIC_CASES.length})`, async () => {
    const LOG = join(process.cwd(), "results-consult-measure.jsonl");
    const done = new Map<string, Rec>();
    if (existsSync(LOG)) {
      for (const line of readFileSync(LOG, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line) as Rec;
        done.set(r.id, r);
      }
      console.log(`이어하기 — 이미 끝난 ${done.size}건은 건너뛴다\n`);
    }

    const recs: Rec[] = [];
    let apiFailures = 0;
    let consecutive = 0;

    for (const [i, c] of ALL_CASES.entries()) {
      const cached = done.get(c.id);
      if (cached) { recs.push(cached); continue; }

      let rec: Rec;
      try {
        const r = await consult({ maskedStatement: c.statement, slots: {}, askedCount: 0 });
        if (r.kind === "OUT_OF_SCOPE") {
          rec = { id: c.id, outOfScope: true, marks: [], failure: null };
        } else {
          rec = { id: c.id, outOfScope: false, marks: score(c, r.slots), failure: null };
        }
        consecutive = 0;
      } catch (e) {
        // ⚠️ API 실패를 오답으로 삼키지 않는다. 제품 측정에서 크레딧 소진 115건을
        //    「형식 오류」로 세어 가짜 수치를 만든 적이 있다.
        const status =
          e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : null;
        rec = {
          id: c.id, outOfScope: false, marks: [],
          failure: `API_${typeof status === "number" ? status : "ERROR"}`,
        };
        apiFailures += 1;
        consecutive += 1;
        if (consecutive >= 3) {
          throw new Error(
            `연속 ${consecutive}건 API 실패 — 측정을 중단한다. ${i + 1}/${ALL_CASES.length}건 진행 후 멈춤. ` +
              `부분 결과로 수치를 만들지 않는다.`,
          );
        }
      }

      appendFileSync(LOG, JSON.stringify(rec) + "\n");
      recs.push(rec);
      const bad = rec.marks.filter((m) => m.mark === "오분류" || m.mark === "날조");
      console.log(
        `[${String(i + 1).padStart(2)}/${ALL_CASES.length}] ${c.id.padEnd(18)} ` +
          (rec.failure ?? (rec.outOfScope ? "범위밖" : bad.length === 0 ? "OK" : bad.map((m) => `${m.mark} ${m.slot} ${m.want}→${m.got}`).join(" · "))),
      );
    }

    expect(apiFailures, "API 실패가 있으면 수치를 내지 않는다").toBe(0);

    const report = (name: string, subset: Rec[]) => {
      const all = subset.flatMap((r) => r.marks);
      const n = (m: Mark) => all.filter((x) => x.mark === m).length;
      const 단서있음 = n("정확") + n("오분류") + n("누락");
      const 단서없음 = n("정상비움") + n("날조");
      const [aLo, aHi] = wilson(n("정확"), 단서있음);
      const [fLo, fHi] = wilson(n("날조"), 단서없음);
      console.log(`
─── ${name} (진술 ${subset.length}건) ───
단서가 있는 슬롯  ${단서있음}
  정확            ${n("정확")}  (${단서있음 ? ((n("정확") / 단서있음) * 100).toFixed(1) : "—"}%)  CI [${aLo.toFixed(1)}, ${aHi.toFixed(1)}]
  오분류          ${n("오분류")}  (${단서있음 ? ((n("오분류") / 단서있음) * 100).toFixed(1) : "—"}%)  ← 엉뚱한 비교군
  누락            ${n("누락")}  (${단서있음 ? ((n("누락") / 단서있음) * 100).toFixed(1) : "—"}%)  ← 되묻기로 회복
단서가 없는 슬롯  ${단서없음}
  정상 비움       ${n("정상비움")}
  날조            ${n("날조")}  (${단서없음 ? ((n("날조") / 단서없음) * 100).toFixed(1) : "—"}%)  CI [${fLo.toFixed(1)}, ${fHi.toFixed(1)}]
범위 밖 판정      ${subset.filter((r) => r.outOfScope).length}건`);
    };

    const byId = new Map(recs.map((r) => [r.id, r]));
    for (const set of SETS) {
      report(
        `상담 계층 슬롯 추출 · ${set.name}`,
        set.cases.map((c) => byId.get(c.id)).filter((r): r is Rec => r !== undefined),
      );
    }
    report("상담 계층 슬롯 추출 · 합산", recs);
    console.log("");

    const marksAll = recs.flatMap((r) => r.marks);
    const wrong = marksAll.filter((m) => m.mark === "오분류" || m.mark === "날조");
    if (wrong.length) {
      console.log("─── 틀린 항목 ───");
      for (const r of recs) {
        for (const m of r.marks) {
          if (m.mark === "오분류" || m.mark === "날조") {
            console.log(`  ${r.id.padEnd(18)} ${m.mark} ${m.slot}: ${m.want} → ${m.got}`);
          }
        }
      }
    }

    // 채점 자체가 성립했는지만 본다. 임계는 두지 않는다 —
    // 이 측정의 목적은 합격/불합격이 아니라 비어 있던 구간에 숫자를 붙이는 것이다.
    const has = (m: Mark) => marksAll.filter((x) => x.mark === m).length;
    expect(has("정확") + has("오분류") + has("누락")).toBeGreaterThan(50);
    expect(has("정상비움") + has("날조")).toBeGreaterThan(5);
  }, 900_000);
});
