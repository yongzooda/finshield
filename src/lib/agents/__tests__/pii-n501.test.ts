/**
 * N-501 — 합성 PII 주입 100건, **미검출 0건이 배포 조건**.
 *
 * 「미검출」의 정의를 분명히 한다. `pii.ts`의 설계는 두 겹이다:
 *   1. 패턴으로 가린다
 *   2. 못 가린 위험은 **잔존 의심(EX-106)으로 전송을 차단**한다
 *
 * 따라서 통과 조건은 **「가려졌거나, 못 가렸으면 차단됐거나」**다.
 * 둘 다 아닌 것 — 원문이 그대로 남았는데 통과까지 한 것 — 이 미검출이다.
 * 그게 실제로 모델과 DB로 새어 나가는 경로다.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PII_TEST_SET_SIZE } from "../../types";
import { gateForModel, maskPii } from "../pii";
import { CLEAN_CASES, PII_CASES } from "./pii-synthetic";

describe("N-501 합성 PII 주입", () => {
  it("100건 이상을 검사한다 (명세 요구 규모)", () => {
    expect(PII_CASES.length).toBeGreaterThanOrEqual(100);
  });

  it("PII_TEST_SET_SIZE — 처리방침이 거는 건수 = 실제 세트 크기", () => {
    // 처리방침(N-504)이 「가상의 사례 n건으로 시험했다」를 화면에 거는데, 그 n이
    // 상수로 박혀 있어 세트가 117 → 132가 된 뒤에도 화면은 117을 말하고 있었다.
    // 세트를 늘리면 여기서 걸린다.
    expect(PII_TEST_SET_SIZE).toBe(PII_CASES.length);
  });

  it("미검출 0건 — 가려지거나, 못 가렸으면 전송이 차단된다", () => {
    const undetected: { id: string; text: string; masked: string }[] = [];
    let masked = 0;
    let blockedOnly = 0;

    for (const c of PII_CASES) {
      const r = maskPii(c.text);
      const gone = !r.text.includes(c.secret);
      if (gone) {
        masked += 1;
        continue;
      }
      if (r.residualSuspicion) {
        blockedOnly += 1; // 못 가렸지만 전송은 막힌다
        continue;
      }
      undetected.push({ id: c.id, text: c.text, masked: r.text });
    }

    // 사람이 읽고 판단할 수 있게 남긴다
    console.log(
      `\n─── N-501 마스킹 측정 (${PII_CASES.length}건) ───\n` +
        `가려짐        ${masked}\n` +
        `차단만        ${blockedOnly}   (패턴은 놓쳤지만 EX-106이 막음)\n` +
        `미검출        ${undetected.length}   ← 배포 조건: 0\n` +
        undetected.map((u) => `  ⚠ ${u.id}  "${u.text}"\n     → "${u.masked}"`).join("\n") +
        "\n",
    );

    /**
     * S-06의 「개인정보 가림 정확도」 행이 읽는 원자료다.
     *
     * 적재 로더가 이 값을 하드코딩하고 있었는데, 세트가 117 → 132건으로 늘자
     * **화면만 117에 남았다.** 로더 자신이 「수치는 전부 원자료에서 센다」를
     * 규약으로 걸어 두고 있으므로(S-06 렌더링 규약), 세는 쪽이 원자료를 낸다.
     */
    writeFileSync(
      join(process.cwd(), "measure", "pii-n501.json"),
      JSON.stringify(
        { total: PII_CASES.length, masked, blockedOnly, undetected: undetected.length, clean: CLEAN_CASES.length },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    expect(undetected, `미검출 ${undetected.length}건 — 배포 조건 위반`).toHaveLength(0);
  });

  it("가려진 값은 모델 전송 게이트도 통과한다", () => {
    // 전부 차단으로 도망가면 서비스가 동작하지 않는다. 실제로 통과하는 비율을 본다
    const passed = PII_CASES.filter((c) => gateForModel(c.text).ok).length;
    console.log(`\n게이트 통과 ${passed}/${PII_CASES.length}건 (나머지는 이용자에게 수정 요청)\n`);
    expect(passed).toBeGreaterThan(0);
  });
});

describe("과잉 마스킹 대가", () => {
  it("정상 문장은 건드리지 않는다", () => {
    const damaged = CLEAN_CASES.filter((t) => maskPii(t).total > 0);
    expect(damaged, `정상 문장이 마스킹됨: ${damaged.join(" / ")}`).toHaveLength(0);
  });

  it("정상 문장이 전송 차단에 걸리지 않는다", () => {
    const blocked = CLEAN_CASES.filter((t) => !gateForModel(t).ok);
    expect(blocked, `정상 문장이 차단됨: ${blocked.join(" / ")}`).toHaveLength(0);
  });
});


describe("금융 행동 문구와 명시한 성명 구분",()=>{
 it("입금 행동과 안내 문구를 이름으로 지우지 않는다",()=>{
  const text="가상의 권유문입니다. 보증료를 먼저 입금하고\n상담원이 안내하는 앱을 설치해 주세요.";
  expect(gateForModel(text).ok).toBe(true);
  expect(maskPii(text).text).toBe(text);
 });
 it("서술어와 같은 이름도 성명 라벨·직책이 명시되면 가린다",()=>{
  for(const text of ["성명: 안내하", "안내하 상담원", "홍길동\n상담원", "성명: 권유문"]){
   const result=maskPii(text);expect(result.total).toBeGreaterThan(0);
   expect(result.text).toContain("[이름]");
  }
 });
});
