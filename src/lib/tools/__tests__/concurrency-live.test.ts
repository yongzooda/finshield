/**
 * **동시 부하 측정** — N-206(동시 10세션)이 Supabase Free에서 성립하는가.
 *
 * ⚠️ 이 시험이 결함을 하나 잡았다. 세션 모드(5432)로 돌리면 동시 15에서
 *    `EMAXCONNSESSION: max clients are limited to pool_size: 15`가 뜬다.
 *    트랜잭션 모드(6543)로 바꾸자 동시 50까지 오류 없이 통과했다.
 *    자세한 내용은 `measure/concurrency.md`.
 *
 * ## 왜 재나
 *
 * D-5는 「Supabase Pro 전환」을 필수 항목으로 적어 두었지만 **근거가 문서 어디에도
 * 없었다.** 실측해 보니 용량은 21MB(한도 500MB)라 무관하고, 정지 조건은
 * 1주일 무활동인데 남은 일정에 1주일 공백이 없다. 그래서 Pro를 살 이유로 남은
 * 것은 **동시 접속 시 공유 CPU가 버티는가** 하나뿐이었고, 그건 한 번도 재본 적이 없다.
 *
 * ## 무엇을 재나
 *
 * 판단 한 사이클이 DB에 거는 실제 부하를 그대로 태운다. `search_case`가
 * `word_similarity`로 코퍼스 본문 전체(388건)를 훑는 가장 무거운 질의이고, 조사 계층의
 * 폴백 사다리 때문에 한 사이클에 두 번 도는 경우가 흔하다.
 *
 * **모델은 부르지 않는다.** 판단 100초 중 DB가 차지하는 몫만 떼어 보는 것이
 * 목적이고, 10세션치 판단을 실제로 돌리면 비용도 API 상한(일 10회)도 걸린다.
 *
 * ## 읽는 법
 *
 * 판단 P95 목표는 120초(N-103)이고 실측 최악이 약 100초다. 그중 DB 몫이
 * 동시 10에서도 몇 초 안이면 병목은 DB가 아니라 모델이다 — 그러면 Free로 충분하다.
 * 사전 점검(N-104)은 목표가 P95 10초이고 DB만으로 도는 경로라 더 직접적인 기준이다.
 *
 *   PRECASE_LIVE=1 npx vitest run src/lib/tools/__tests__/concurrency-live.test.ts --disable-console-intercept
 */

import { describe, expect, it } from "vitest";
import { searchCase } from "../search_case";
import { checkDocuments } from "../check_documents";
import { analyzeRiskPattern } from "../analyze_risk_pattern";

const live = process.env.PRECASE_LIVE === "1";

/** 질의마다 다른 본문을 준다 — 같은 문장만 반복하면 캐시가 실제보다 유리하게 나온다. */
const FACTS = [
  "은행 창구에서 ELS에 가입했는데 원금이 보장된다고 들었고 손실 가능성은 설명받지 못했다",
  "전화로 종신보험을 권유받아 가입했으며 해지환급금이 원금보다 적다는 안내가 없었다",
  "설계사가 방문해 연금보험을 권유했고 적합성 설문을 대신 작성했다",
  "홈쇼핑 방송을 보고 저축성 보험에 가입했는데 예금으로 이해했다",
  "증권사 지점에서 펀드에 가입했고 투자 경험이 전혀 없었다",
];

const CHANNELS = ["BRANCH", "TM", "AGENT", "BANCA_HS", "ONLINE"] as const;
const PRODUCTS = ["INV_ELS", "INS_WHOLE", "INS_ANNUITY", "INS_SAVINGS", "INV_FUND"] as const;
const ISSUES = ["설명의무", "부당권유", "적합성원칙", "약관해석"];

/** 판단 한 사이클이 DB에 거는 일. 조사 계층의 폴백 사다리를 반영해 search_case를 두 번 돈다. */
async function oneSession(i: number): Promise<number> {
  const t0 = performance.now();
  const k = i % FACTS.length;
  await searchCase({
    productCode: PRODUCTS[k],
    channel: CHANNELS[k],
    issues: [ISSUES[i % ISSUES.length]],
    factsText: FACTS[k],
    limit: 3,
  });
  // 폴백 — 조건을 넓혀 다시 훑는다 (실측에서 흔한 경로)
  await searchCase({ productCode: PRODUCTS[k], factsText: FACTS[k], limit: 3 });
  await checkDocuments({ issues: [ISSUES[i % ISSUES.length]], channel: CHANNELS[k] });
  await analyzeRiskPattern({ productCode: PRODUCTS[k], channel: CHANNELS[k] });
  return performance.now() - t0;
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}

describe.runIf(live)("동시 부하 (Supabase Free)", () => {
  it("동시 1 · 5 · 10 · 20 · 50 세션에서 DB 몫", async () => {
    // 커넥션·캐시를 데운 뒤 잰다. 첫 질의의 연결 비용을 부하로 오해하지 않기 위함이다.
    await oneSession(0);

    const rows: { conc: number; s: ReturnType<typeof stats>; wall: number }[] = [];
    for (const conc of [1, 5, 10, 20, 50]) {
      const t0 = performance.now();
      const ms = await Promise.all(Array.from({ length: conc }, (_, i) => oneSession(i)));
      rows.push({ conc, s: stats(ms), wall: performance.now() - t0 });
    }

    console.log(`
─── 판단 1사이클의 DB 몫 (모델 미호출) ───
동시   세션당 p50    p95      최대     전체 벽시계
${rows
  .map(
    (r) =>
      `${String(r.conc).padStart(3)}   ${(r.s.p50 / 1000).toFixed(2)}초    ` +
      `${(r.s.p95 / 1000).toFixed(2)}초   ${(r.s.max / 1000).toFixed(2)}초   ${(r.wall / 1000).toFixed(2)}초`,
  )
  .join("\n")}

질의 구성: search_case ×2 (word_similarity 코퍼스 전체 훑기) · check_documents ×1 · analyze_risk_pattern ×1
`);

    const at10 = rows.find((r) => r.conc === 10)!;
    const at1 = rows.find((r) => r.conc === 1)!;
    console.log(
      `동시 10에서 세션당 p95 = ${(at10.s.p95 / 1000).toFixed(2)}초 ` +
        `(단독 대비 ${(at10.s.p95 / at1.s.p95).toFixed(1)}배)\n`,
    );

    // N-104 사전 점검 P95 10초가 DB만으로 도는 가장 직접적인 기준이다.
    // 판단 사이클 전체 DB 몫이 그 안에 들면 사전 점검은 여유가 크다.
    expect(at10.s.p95, "동시 10세션에서 판단 1사이클의 DB 몫이 10초를 넘으면 안 된다").toBeLessThan(
      10_000,
    );
  }, 600_000);
});
