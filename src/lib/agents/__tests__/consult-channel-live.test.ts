/**
 * 채널 슬롯 실호출 검증 (N-201 · F-301).
 *
 * `slot-vocab.test.ts`는 **문구가 일치하는지**를 소스에서 본다. 이 테스트는
 * **모델이 실제로 그렇게 분류하는지**를 본다 — 문구를 맞춰도 모델이 다르게
 * 고르면 결함은 그대로다.
 *
 * 2026.08.21 시뮬레이터 실주행에서 발견: 「은행 창구에서 ELS 가입」이
 * `BANCA_HS`로 잡혔다. 방카슈랑스는 은행에서 파는 **보험**이라 ELS에 맞지
 * 않고, 코퍼스는 같은 사건을 `BRANCH`로 라벨한다. 채널은 `search_case`·
 * `analyze_risk_pattern`의 필터라 **비교군이 통째로 어긋난다.**
 *
 *   PRECASE_LIVE=1 npx vitest run src/lib/agents/__tests__/consult-channel-live.test.ts
 */

import { describe, expect, it } from "vitest";
import { consult } from "../consult";
import type { Slots } from "../../types";

const live = process.env.PRECASE_LIVE === "1";

/** 되묻기든 확정이든 이 시험이 보는 것은 추출된 슬롯뿐이다. */
async function channelOf(maskedStatement: string): Promise<Partial<Slots>> {
  const r = await consult({ maskedStatement, slots: {}, askedCount: 0 });
  if (r.kind === "OUT_OF_SCOPE") throw new Error(`범위 밖으로 분류됨: ${r.message}`);
  return r.slots;
}

describe.runIf(live)("채널 분류 실호출", () => {
  it("은행 창구에서 판 ELS는 BRANCH다 (방카슈랑스가 아니다)", async () => {
    const slots = await channelOf(
      "2019년 5월에 은행 창구에서 ELS 상품에 가입했습니다. 그때 제 나이가 67세였습니다. " +
        "창구 직원이 원금은 보장되는 안전한 상품이라고 했고, 손실이 날 수 있다는 설명은 " +
        "듣지 못했습니다. 지금 원금의 40% 정도를 잃었습니다.",
    );
    console.log("채널:", slots.channel, "· 상품:", slots.product);
    expect(slots.channel).toBe("BRANCH");
    expect(slots.product).toBe("INV_ELS");
  }, 120_000);

  it("은행에서 든 보험은 BANCA_HS다", async () => {
    const slots = await channelOf(
      "2020년 3월에 은행에서 저축성 보험에 가입했습니다. 예금인 줄 알았는데 보험이었습니다.",
    );
    console.log("채널:", slots.channel, "· 상품:", slots.product);
    expect(slots.channel).toBe("BANCA_HS");
  }, 120_000);
});
