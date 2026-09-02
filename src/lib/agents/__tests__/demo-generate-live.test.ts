/**
 * 데모 3종 데이터 **생성기** (DR-107 · F-701). `PRECASE_LIVE=1`일 때만 돈다.
 *
 * ⚠️ 이건 테스트가 아니라 **생성 도구**다. 데모 데이터를 손으로 쓰면 그 순간
 * 「도구가 반환하지 않은 것을 화면에 올리는」 일이 된다 — 이 프로젝트가 막으려는
 * 바로 그것이다. 그래서 **실제 도구·실제 모델을 돌려** 나온 결과를 그대로 굳힌다.
 *
 * ## 판단 데모는 실제 조정례로 만든다
 *
 * 기획서 5.2의 가상 인물(김순자)로 돌렸을 때는 유보가 나왔다. 같은 시나리오를
 * 결론이 나올 때까지 재실행하는 것은 측정을 굴리는 짓이라 하지 않았다.
 * 대신 **제품 기준 측정(검증셋 120건)에서 실제로 결론이 나고 정답이었던 사건**을
 * 쓴다. 지어낸 것이 아니라 실측 결과다.
 *
 *   B 결론 — 제2010-45호 (ELS · 은행 창구 · 설명의무·부당권유 · 배상 인정)
 *            기획서 시나리오 B와 사실상 같은 구조의 실제 사건이다
 *   D 유보 — 측정에서 확신도가 임계에 못 미친 사건
 *   A 예방 — 홈쇼핑 · 저축성보험 · 63세 (기획서 5.1, 모델 미사용)
 *
 * 다시 뽑으려면:
 *   PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/demo-generate-live.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "../../db";
import { analyzeRiskPattern } from "../../tools/analyze_risk_pattern";
import { checkDocuments } from "../../tools/check_documents";
import { lookupStatute } from "../../tools/lookup_statute";
import { PROCEDURE_STATUTES } from "../../procedure";
import { runJudgment } from "../pipeline";
import { createSession } from "../session";
import type { Slots } from "../../types";

const live = process.env.PRECASE_LIVE === "1";
const OUT = join(process.cwd(), "src/lib/demo");

function write(name: string, banner: string, value: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, `${name}.ts`),
    `${banner}\n\nexport default ${JSON.stringify(value, null, 2)} as const;\n`,
    "utf8",
  );
}

const BANNER = (what: string) =>
  `/* 자동 생성 — demo-generate-live.test.ts. 손으로 고치지 말 것.\n   ${what} */`;

/** 조정례 원문에서 사실관계를 가져온다 — 데모도 실제 자료로 만든다 */
async function factsOf(decisionNo: string) {
  const [c] = await sql<{ facts_summary: string; product_code: Slots["product"] | null;
    channel: string | null; case_year: number | null }[]>`
    select facts_summary, product_code, channel, case_year
    from cases where decision_no = ${decisionNo} limit 1`;
  expect(c, `${decisionNo}를 찾지 못했다`).toBeTruthy();
  return c;
}

async function judgeCase(
  name: string,
  decisionNo: string,
  issues: string[],
  expectKind: string,
  /**
   * 가입 연월 — **원문에 적힌 값을 그대로 옮긴다.** 호출부에 근거 문구를 함께 적는다.
   *
   * 예전에는 `${case_year}-01`을 넣었는데 둘 다 틀렸다: `case_year`는 **조정 결정
   * 연도**이지 가입 연도가 아니고(제2010-45호의 실제 가입은 2008년), 월 `01`은
   * 지어낸 값이다. 화면은 그것을 「가입 시점 2010-01」로 표시하고 있었다.
   *
   * `UNKNOWN`으로 비우는 것도 답이 아니었다 — `contract_ym`은 **기준일을 정하고
   * 기준일이 적용 법령을 가른다**(F-303). 비우면 시점 종속 법령(자본시장법)을
   * 조회할 수 없어 근거 0건으로 유보된다(실측: 결론 데모가 유보로 뒤집혔다).
   *
   * 코퍼스에 구조화된 가입 연월 «필드»가 없을 뿐, **사실관계 원문에는 적혀
   * 있다.** 그래서 지어내지도 버리지도 않고 옮겨 적는다 — 도구가 반환한 텍스트
   * 안에 있는 값이므로 새로 만든 것이 아니다.
   */
  contractYm: string,
) {
  const c = await factsOf(decisionNo);
  const session = createSession();
  session.slots = {
    channel: (c.channel as Slots["channel"]) ?? "UNKNOWN",
    age: "UNKNOWN",
    product: c.product_code ?? "ETC_UNKNOWN",
    contract_ym: contractYm,
    traits: ["NONE"],
  };
  session.facts = { statements: [c.facts_summary], issues, unresolved: [] };

  let done: unknown = null;
  for await (const ev of runJudgment(session)) {
    if (ev.type === "done") done = ev;
    if (ev.type === "error") throw new Error(`파이프라인 실패: ${ev.message}`);
  }

  const d = done as {
    outcome: { kind: string; judgment?: { confidence: number }; confidence?: number | null };
    evidence: { statutes: unknown[]; cases: unknown[] }; trace: unknown[];
  };
  /**
   * 절차 안내 조문(R-07 ②)을 번들에 함께 굳힌다.
   *
   * 실서비스는 이것을 서버가 요청 시 조회하는데, 데모는 **외부 조회를 하지
   * 않는다**(DR-107 — DB·모델·법제처 장애에도 열람 보장). 그래서 조회는
   * 여기 생성 시점에 한 번 하고 결과를 굳힌다 — 다른 도구 반환값과 같은
   * 취급이며, 화면이 렌더하는 것은 여전히 도구가 반환한 원문뿐이다.
   */
  const today = new Date().toISOString().slice(0, 10);
  const procedureStatutes = (
    await Promise.all(
      PROCEDURE_STATUTES.map((a) => lookupStatute({ ...a, basisDate: today }).catch(() => null)),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);
  expect(procedureStatutes.length, "절차 조문을 하나도 받지 못했다 — 법제처 조회를 확인할 것").toBe(3);

  const conf = d.outcome.judgment?.confidence ?? d.outcome.confidence;
  console.log(`\n[${name}] ${decisionNo} → ${d.outcome.kind} · 확신도 ${conf}` +
    ` · 법령 ${d.evidence.statutes.length} · 조정례 ${d.evidence.cases.length} · 로그 ${d.trace.length}단계\n`);

  expect(d.outcome.kind, `${expectKind}가 나와야 데모로 쓸 수 있다`).toBe(expectKind);
  write(
    name,
    BANNER(
      `실제 4계층 파이프라인을 ${decisionNo} 사실관계로 돌린 결과다.\n` +
        `   절차 안내 조문 3종도 같은 시점에 실조회해 함께 굳혔다 (DR-107 — 데모는 외부 조회 없음).`,
    ),
    { ...(done as object), procedureStatutes },
  );
}

describe.runIf(live)("데모 3종 생성", () => {
  it("A 예방 — 홈쇼핑 · 저축성보험 · 63세 (모델 미사용)", async () => {
    const risk = await analyzeRiskPattern({
      productCode: "INS_SAVINGS", channel: "BANCA_HS", trait: "ELDER",
    });
    expect(risk).not.toBeNull();
    const docs = await checkDocuments({
      issues: risk!.issues.map((i) => i.issueCode), channel: "BANCA_HS",
    });
    write("prevention", BANNER("실제 도구(analyze_risk_pattern · check_documents) 반환값이다."),
      { risk, docs, product: "INS_SAVINGS", channel: "BANCA_HS", age: 63 });
    console.log(`\n[A 예방] 쟁점 ${risk!.issues.length}종 · 자료 ${docs.required.length}종\n`);
  }, 120_000);

  it("B 판단-결론 — 제2010-45호 (ELS · 은행 창구)", async () => {
    // 가입 연월 근거 — 사실관계 원문: 「2008.6.12. 신청인은 담당직원을 통하여
    // ‘파생상품 투자신탁 4호’(이하 ‘본건 상품’이라 함)에 … 가입」
    await judgeCase("concluded", "제2010-45호", ["설명의무", "부당권유"], "CONCLUDED", "2008-06");
  }, 300_000);

  it("D 판단-유보 — 확신도가 임계에 못 미친 사건", async () => {
    // 가입 연월 근거 — 사실관계 원문의 계약 내역표: 「(무)종신보험 … 계약일자 2004.11.19.」
    await judgeCase("withheld", "제2010-55호", ["약관해석"], "WITHHELD", "2004-11");
  }, 300_000);
});
