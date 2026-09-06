/** 등록부 값과 사용자가 낸 값을 같은 형태로 맞춘다 */

import { describe, expect, it } from "vitest";
import { normalizeChannelValue } from "../tools/registry";

describe("공식 채널 값 정규화", () => {
  it("주소는 scheme 와 www 와 끝 빗금을 뺀다", () => {
    expect(normalizeChannelValue("https://www.kinfa.or.kr/")).toBe("kinfa.or.kr");
    expect(normalizeChannelValue("HTTP://KINFA.OR.KR")).toBe("kinfa.or.kr");
    expect(normalizeChannelValue("kinfa.or.kr")).toBe("kinfa.or.kr");
  });

  it("경로가 있으면 그대로 둔다", () => {
    expect(normalizeChannelValue("https://www.kinfa.or.kr/cyber/center.do"))
      .toBe("kinfa.or.kr/cyber/center.do");
  });

  it("전화번호는 숫자만 남긴다", () => {
    expect(normalizeChannelValue("1332")).toBe("1332");
    expect(normalizeChannelValue("02-3145-5114")).toBe("0231455114");
    expect(normalizeChannelValue("+82 2 3145 5114")).toBe("82231455114");
  });

  it("빈 값은 빈 문자열로 둔다", () => {
    expect(normalizeChannelValue("   ")).toBe("");
  });

  it("숫자가 섞인 도메인을 전화번호로 오인하지 않는다", () => {
    expect(normalizeChannelValue("https://bank15.example.kr")).toBe("bank15.example.kr");
  });
});
