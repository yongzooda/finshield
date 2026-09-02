/**
 * N-203 IP 레이트 리밋 검증.
 *
 * 검사할 것 셋:
 *   ① 상한을 실제로 막는가
 *   ② **차단 시간을 알리는가** — EX-405가 「정상 사용자 오차단 가능성을 고려해
 *      차단 시간 명시」를 요구한다. 「잠시」로 뭉개면 안 된다
 *   ③ **원본 IP를 들고 있지 않은가** — 준식별자라 메모리에도 두지 않는다
 */

import { beforeEach, describe, expect, it } from "vitest";
import { _reset, clientKey, clientKeyFromHeaders, consume, waitMessage } from "../rate-limit";

beforeEach(() => _reset());

describe("상한", () => {
  it("상한까지는 통과하고 그 다음부터 막는다", () => {
    const k = clientKey("203.0.113.1");
    for (let i = 0; i < 3; i++) expect(consume(k, "REQUEST", 3).ok).toBe(true);
    expect(consume(k, "REQUEST", 3).ok).toBe(false);
  });

  it("다른 이용자는 서로 영향을 주지 않는다", () => {
    const a = clientKey("203.0.113.1");
    const b = clientKey("203.0.113.2");
    for (let i = 0; i < 3; i++) consume(a, "REQUEST", 3);
    expect(consume(a, "REQUEST", 3).ok).toBe(false);
    expect(consume(b, "REQUEST", 3).ok).toBe(true);
  });

  it("종류마다 따로 센다 — 되묻기가 판단 상한을 깎지 않는다", () => {
    const k = clientKey("203.0.113.1");
    for (let i = 0; i < 5; i++) consume(k, "REQUEST", 5);
    expect(consume(k, "REQUEST", 5).ok).toBe(false);
    expect(consume(k, "JUDGMENT", 5).ok).toBe(true);
  });
});

describe("EX-405 차단 시간 안내", () => {
  it("막을 때 남은 시간을 함께 준다", () => {
    const k = clientKey("203.0.113.1");
    consume(k, "REQUEST", 1);
    const r = consume(k, "REQUEST", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("「잠시」로 뭉개지 않고 얼마나인지 말한다", () => {
    expect(waitMessage(30)).toContain("30초");
    expect(waitMessage(300)).toContain("5분");
    expect(waitMessage(7200)).toContain("2시간");
  });

  it("이용자 책임처럼 읽히지 않는다 (EP-5)", () => {
    for (const m of [waitMessage(30), waitMessage(7200)]) {
      for (const bad of ["남용", "과도", "너무 많이 하셨"]) expect(m).not.toContain(bad);
    }
  });

  it("일 단위 상한은 「오늘 다 쓰셨다」로 알린다", () => {
    expect(waitMessage(7200)).toContain("오늘");
  });
});

describe("IP를 들고 있지 않는다 (DR-30x)", () => {
  it("키에서 원본 IP를 알아볼 수 없다", () => {
    const ip = "203.0.113.77";
    const k = clientKey(ip);
    expect(k).not.toContain(ip);
    // 옥텟 하나가 우연히 16진 해시에 들어가는 것은 유출이 아니다.
    // 「203」 같은 3자리가 24자 해시에 섞일 확률은 1%가 넘어서, 그걸로 판정하면
    // 통과·실패가 소금에 따라 흔들린다(2026.08.23 CI에서 실제로 터졌다).
    // 확인할 것은 **되돌릴 수 없다**는 성질이지 특정 숫자의 부재가 아니다.
    expect(k).toMatch(/^[0-9a-f]{24}$/);
    // 점 표기·옥텟 나열 어느 형태로도 원문이 남지 않는다
    for (const form of [ip, ip.replaceAll(".", ""), ip.split(".").reverse().join(".")]) {
      expect(k).not.toContain(form);
    }
    // 소금이 프로세스마다 달라 같은 IP라도 배포가 바뀌면 다른 키가 된다 —
    // 키를 모아 두어도 IP 목록으로 되돌릴 수 없다는 근거다
    expect(clientKey(ip)).toBe(k);
  });

  it("같은 IP는 같은 키, 다른 IP는 다른 키", () => {
    expect(clientKey("203.0.113.1")).toBe(clientKey("203.0.113.1"));
    expect(clientKey("203.0.113.1")).not.toBe(clientKey("203.0.113.2"));
  });

  it("헤더에서 뽑을 때도 해시만 남는다", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" });
    const k = clientKeyFromHeaders(h);
    expect(k).not.toContain("203.0.113.9");
    // 프록시 체인의 첫 값(실제 이용자)을 쓴다
    expect(k).toBe(clientKey("203.0.113.9"));
  });

  it("IP를 못 얻어도 죽지 않는다", () => {
    expect(clientKeyFromHeaders(new Headers())).toMatch(/^[0-9a-f]{24}$/);
  });
});
