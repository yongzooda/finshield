/**
 * 판단 진행 화면 — S-03에서 S-04로 넘어가는 **전이 구간**이다.
 *
 * 화면 명세 S-03 전이: "판단 완료 → S-04 자동 전이 (T-1). 처리 중 로딩 상태는
 * 4.3 규칙". 그 로딩 상태가 이 화면이다. 판단 파이프라인은 실측 최악 100초라
 * (N-103) 빈 화면으로 둘 수 없다.
 *
 * ⚠️ **결과는 아직 렌더하지 않는다.** F-306은 결론·확신도·근거 3분류·신청권·1332·
 * 판단이 달라지는 조건까지 한 벌로 요구한다. 일부만 보여주면 그 자체로 위반이라,
 * 결과 표시는 S-04에서 한 번에 만든다.
 */

import type { Metadata } from "next";
import { JudgmentProgress } from "./judgment-progress";
import { lookupStatute } from "@/lib/tools/lookup_statute";
import { PROCEDURE_STATUTES } from "@/lib/procedure";

export const metadata: Metadata = {
  title: "살펴보는 중 — 프리케이스",
};

/**
 * 절차 안내 조문은 **여기(서버)에서 조회한다** (R-07 ②).
 *
 * 판단 파이프라인에 넣지 않는 이유는 둘이다 — ① 판단 근거가 아니라 안내
 * 자료라 조사 계층의 도구 예산(N-201)을 쓸 이유가 없고 ② 사건과 무관한
 * 고정 조문이라 캐시(TTL 1일)에 그대로 얹힌다.
 *
 * 조회 실패는 화면을 막지 않는다 — 못 받은 조문은 렌더되지 않고, 자료
 * 열람 요구권 문단은 근거 조문과 함께 사라진다 (`procedure.tsx`).
 */
async function procedureStatutes() {
  const today = new Date().toISOString().slice(0, 10);
  const rs = await Promise.all(
    PROCEDURE_STATUTES.map((a) =>
      lookupStatute({ ...a, basisDate: today }).catch(() => null),
    ),
  );
  return rs.filter((r): r is NonNullable<typeof r> => r !== null);
}

export default async function JudgmentPage() {
  return <JudgmentProgress procedureStatutes={await procedureStatutes()} />;
}
