/**
 * S-14 해피콜 연습 화면 — 렌더 규약.
 *
 * · A11Y-4: 진행 화면에 질문이 하나만 보인다
 * · 답을 고르기 전에는 해설·다음 버튼이 없다 — 해설을 건너뛰는 경로 차단
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HappycallChooser, HappycallFlow } from "../happycall-flow";
import { HAPPYCALL_SCENARIOS, TM_INSURANCE } from "@/lib/happycall";

describe("S-14 해피콜 연습 화면", () => {
  it("첫 화면은 안내 + 시작 버튼이다 — 질문을 미리 보이지 않는다", () => {
    const html = renderToStaticMarkup(<HappycallFlow scenario={TM_INSURANCE} />);
    expect(html).toContain("연습 시작하기");
    for (const n of TM_INSURANCE.nodes) {
      expect(html).not.toContain(n.question);
    }
  });

  it("안내문이 전부 나온다 — 녹음된다는 사실을 시작 전에 알린다", () => {
    const html = renderToStaticMarkup(<HappycallFlow scenario={TM_INSURANCE} />);
    for (const p of TM_INSURANCE.intro) expect(html).toContain(p);
  });

  it("시나리오가 여럿이면 선택 화면이 먼저다 — 질문·안내를 미리 보이지 않는다", () => {
    const html = renderToStaticMarkup(<HappycallChooser scenarios={HAPPYCALL_SCENARIOS} />);
    for (const sc of HAPPYCALL_SCENARIOS) {
      expect(html).toContain(sc.title);
      for (const n of sc.nodes) expect(html).not.toContain(n.question);
    }
  });

  it("시나리오가 하나뿐이면 선택 없이 바로 안내로 간다", () => {
    const html = renderToStaticMarkup(<HappycallChooser scenarios={[TM_INSURANCE]} />);
    expect(html).toContain("연습 시작하기");
    expect(html).not.toContain("어떤 경로로 가입하셨나요");
  });
});
