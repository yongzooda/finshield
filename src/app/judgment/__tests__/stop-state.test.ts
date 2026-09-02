/**
 * 판단이 시작되지 못했을 때 **세션을 버릴지**를 고정한다 (N-701).
 *
 * 갈림길은 하나다. 410은 세션이 실제로 사라진 것이라 다시 시도해도 같은 답이
 * 온다. 그러나 429(레이트 리밋)·503(예산 소진)·5xx는 세션이 멀쩡한데 지금
 * 못 받을 뿐이다. 여기서 세션을 버리면 **잠시 뒤 될 일에 상담을 처음부터 다시**
 * 시키게 된다 — 진술을 다시 쓰고 되묻기를 다시 받아야 한다는 뜻이다.
 *
 * 카카오톡 인앱 브라우저에서 특히 아프다. 폰으로 4,000자를 다시 쓰게 된다.
 */

import { describe, expect, it } from "vitest";
import { stopForStatus } from "../judgment-progress";

describe("판단 시작 실패 분류", () => {
  it("410 — 세션이 사라졌다. 버리고 다시 시도를 권하지 않는다", () => {
    const r = stopForStatus(410, "상담 내용이 사라졌습니다.");
    expect(r.keepSession).toBe(false);
    expect(r.view.retry).toBe(false);
    expect(r.view.message).toBe("상담 내용이 사라졌습니다.");
  });

  it.each([429, 503, 500, 502, 504])(
    "%d — 세션은 멀쩡하다. 붙들고 다시 시도할 길을 준다",
    (status) => {
      const r = stopForStatus(status, "잠시 후 다시 시도해 주세요.");
      expect(r.keepSession).toBe(true);
      expect(r.view.retry).toBe(true);
    },
  );

  it("서버가 준 안내가 있으면 그대로 쓴다 — 대기 시간·쿼터 문구가 여기 실린다", () => {
    const r = stopForStatus(429, "1분 뒤에 다시 시도해 주세요.");
    expect(r.view.message).toBe("1분 뒤에 다시 시도해 주세요.");
  });

  it("안내가 없어도 빈 화면을 만들지 않는다", () => {
    for (const status of [410, 503]) {
      const r = stopForStatus(status, null);
      expect(r.view.title.length).toBeGreaterThan(0);
      expect(r.view.message.length).toBeGreaterThan(0);
    }
  });

  it("실패를 이용자 잘못처럼 말하지 않는다 (EP-3)", () => {
    const r = stopForStatus(500, null);
    expect(r.view.message).not.toMatch(/잘못|오류입니다|실패했습니다\./);
    expect(r.view.message).toContain("저희 쪽");
  });
});
