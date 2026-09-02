/**
 * 유보 이어가기 화면 변형 (F-308 확장 · R-07 ①).
 *
 * 잡으려는 회귀 둘: ① 재진입인데 «필요 자료» 목록이 화면에서 사라지는 것 —
 * 이용자는 무엇을 확인해 왔는지 볼 수 있어야 한다 ② 이어가기 변형이 신규
 * 상담 문구를 건드리는 것 — 신규 경로는 무변경이어야 한다 (측정 유효성).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Statement } from "../consult-flow";

const noop = () => {};

describe("S-03 이어가기 화면 (F-308 확장)", () => {
  it("재진입이면 제목·라벨이 바뀌고 필요 자료 목록이 보인다", () => {
    const html = renderToStaticMarkup(
      <Statement
        busy={false}
        reentry={["가입 당시 서명한 상품설명서", "해피콜 녹취"]}
        onSubmit={noop}
      />,
    );
    expect(html).toContain("이어서 진행합니다");
    expect(html).toContain("보탠 내용");
    expect(html).toContain("가입 당시 서명한 상품설명서");
    expect(html).toContain("해피콜 녹취");
    // 이전 답변이 유지된다는 안내 — 이게 없으면 이용자가 처음부터 다시 쓴다
    expect(html).toContain("그대로 남아");
  });

  it("신규 상담 화면은 기존 문구 그대로다", () => {
    const html = renderToStaticMarkup(<Statement busy={false} onSubmit={noop} />);
    expect(html).toContain("어떤 일이 있었는지 말씀해 주세요");
    expect(html).toContain("있었던 일");
    expect(html).not.toContain("이어서 진행합니다");
    expect(html).not.toContain("보탠 내용");
  });
});
