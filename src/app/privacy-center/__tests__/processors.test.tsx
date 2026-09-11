import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyCenterPage from "../page";
import { PROCESSORS } from "../processors";

describe("처리를 맡기는 곳 (SEC-PRI-001·SEC-AI-008)", () => {
  const html = renderToStaticMarkup(<PrivacyCenterPage />);

  it("코드가 자료를 보내는 다섯 회사를 모두 적는다", () => {
    for (const name of ["Anthropic", "Cohere", "CLOVA OCR", "Supabase", "Vercel"]) expect(html).toContain(name);
    expect(PROCESSORS).toHaveLength(5);
  });

  it("외부 OCR 과 검색 순위 계산이 언제 보내지 않는지 적는다", () => {
    expect(html).toContain("별도로 동의한 경우에만");
    expect(html).toContain("로그인 없는 체험에서는 보내지 않습니다");
  });

  it("확인하지 않은 계약 조건을 확인한 것처럼 적지 않는다", () => {
    expect(html).toContain("아직 계정 설정 확인을 마치지 않았습니다");
    expect(html).not.toMatch(/학습에 사용하지 않습니다|국내에만 보관|DPA 체결/);
  });
});
