import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FsLoginCard } from "../fs-session";

describe("로그인 카드의 비밀번호 분실 안내 (S-002)", () => {
  it("보낼 수 없는 재설정 메일 대신 실제로 할 수 있는 일을 알린다", () => {
    const html = renderToStaticMarkup(<FsLoginCard onToken={() => undefined} />);
    expect(html).toContain("비밀번호를 잊으셨나요?");
    expect(html).toContain("비밀번호 재설정 메일을 보내지 않습니다");
    expect(html).toContain("새 이메일 주소로 다시 가입해");
    expect(html).toContain("새 계정 만들기");
    expect(html).not.toMatch(/재설정 메일을 보냈|메일 보내기/);
  });
});
