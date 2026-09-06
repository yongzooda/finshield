/** E-022 — URL 은 열지 않고 문자열로만 본다 */

import { describe, expect, it } from "vitest";
import { parseUrlFacts, parseUrlHost } from "../tools/url";

describe("URL 문자열 분석", () => {
  it("호스트와 상위 도메인을 뜯는다", () => {
    const facts = parseUrlFacts("https://apply.example.co.kr/loan/step1");
    expect(facts.parsed).toBe(true);
    expect(facts.host).toBe("apply.example.co.kr");
    expect(facts.registrable_suffix).toBe("co.kr");
    expect(facts.path_depth).toBe(2);
  });

  it("주소에 심어 둔 사용자 정보와 포트를 관측한다", () => {
    const facts = parseUrlFacts("https://kinfa.or.kr@evil.example:8443/");
    expect(facts.has_userinfo).toBe(true);
    expect(facts.has_port).toBe(true);
    expect(facts.host).toBe("evil.example");
  });

  it("punycode 와 문자 혼용을 관측한다", () => {
    expect(parseUrlFacts("https://xn--9t4b11rs0a.com/").has_punycode).toBe(true);
    expect(parseUrlFacts("https://서민금융kinfa.kr/").mixed_script).toBe(true);
  });

  it("형식이 틀린 주소는 해석 실패로 남긴다", () => {
    const facts = parseUrlFacts("햇살론15 신청하세요");
    expect(facts.parsed).toBe(false);
    expect(facts.host).toBeNull();
  });

  it("사용자가 낸 주소는 근거가 아니라 맥락으로 남는다", async () => {
    const outcome = await parseUrlHost({ urls: ["https://apply.example.co.kr/"] });
    // 공식 출처가 아니므로 Snapshot 도 근거도 만들지 않는다.
    expect(outcome.items).toEqual([]);
    const facts = (outcome.observations as { facts: { host: string }[] }).facts;
    expect(facts).toHaveLength(1);
    expect(facts[0].host).toBe("apply.example.co.kr");
  });

  it("주소가 없으면 관측도 비어 있다", async () => {
    const outcome = await parseUrlHost({});
    expect(outcome.items).toEqual([]);
    expect((outcome.observations as { facts: unknown[] }).facts).toEqual([]);
    expect(outcome.provenanceComplete).toBe(true);
  });
});
