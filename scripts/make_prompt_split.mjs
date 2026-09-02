/**
 * 확신도 루브릭 본실험의 훈련/홀드아웃 분할 생성기 (D-7 · R-04 파생).
 *
 * 검증셋 120건을 훈련 60 · 홀드아웃 60으로 나눈다. 규칙은 01-scope 9.1
 * R-04 행에 사전 고정돼 있다:
 *
 *   - 층 = (상품군 그룹 INS/INV/BNK/ETC) × (인용/기각)
 *   - 층 안에서 사건번호 정렬 후 교차 배정 (홀수 층의 잉여 1건은
 *     그 시점까지의 전역 합계가 적은 쪽으로 — 결정적 그리디)
 *   - 난수 없음. 같은 검증셋이면 언제 돌려도 같은 분할이 나온다
 *
 * 사건번호가 대체로 연도순이라 교차 배정이 연도 균형도 함께 잡는다.
 * 산출물 `measure/prompt-split.json`은 커밋한다 — 수치의 재현 조건이다
 * (N-803). 검증셋이 바뀌지 않는 한 재생성할 일은 없다.
 *
 *   node --env-file=.env.local scripts/make_prompt_split.mjs
 */

import { writeFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await sql`
  select decision_no, verdict, product_code
  from cases
  where is_validation and facts_summary is not null
  order by decision_no`;
await sql.end();

// UTF-16 코드유닛 비교 — localeCompare는 로케일에 따라 달라져 결정성이 깨진다
const byNo = (a, b) => (a.decision_no < b.decision_no ? -1 : a.decision_no > b.decision_no ? 1 : 0);

const strata = new Map();
for (const r of rows) {
  const key = `${(r.product_code ?? "ETC").split("_")[0]}/${r.verdict}`;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push(r);
}

// 층 순회 순서도 결정적으로: 크기 내림차순, 같으면 키 사전순
const ordered = [...strata.entries()].sort(
  (a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1),
);

const train = [];
const holdout = [];
for (const [, members] of ordered) {
  members.sort(byNo);
  // 잉여 1건(홀수 층)이 배정되는 sideA를 현재 합계가 적은 쪽으로 준다
  const [sideA, sideB] = train.length <= holdout.length ? [train, holdout] : [holdout, train];
  members.forEach((m, i) => (i % 2 === 0 ? sideA : sideB).push(m.decision_no));
}

train.sort();
holdout.sort();

const out = {
  generated_by: "scripts/make_prompt_split.mjs",
  rule: "(상품군 그룹×인용기각) 층 내 사건번호 정렬 교차 배정, 잉여는 전역 균형 그리디 — 01-scope 9.1 R-04 파생 본실험",
  n: rows.length,
  strata: Object.fromEntries(ordered.map(([k, v]) => [k, v.length])),
  train,
  holdout,
};

if (train.length + holdout.length !== rows.length || new Set([...train, ...holdout]).size !== rows.length) {
  throw new Error("분할이 검증셋을 정확히 덮지 않는다");
}

writeFileSync("measure/prompt-split.json", JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`훈련 ${train.length} · 홀드아웃 ${holdout.length} → measure/prompt-split.json`);
