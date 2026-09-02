/**
 * 세션 통로가 **스토리지 없이도 버티는지** 본다 (N-701).
 *
 * 카카오톡 인앱 브라우저처럼 `sessionStorage`가 막히는 환경이 있다. 예전에는
 * 예외를 삼키기만 해서, 상담을 끝까지 마친 뒤 S-04에서 「이어서 볼 상담이
 * 없습니다」로 막다른 길이 됐다 — 몇 분과 모델 호출을 쓰고 나서야 알게 되는
 * 실패다. S-03 → S-04는 소프트 내비게이션이라 메모리 사본으로 건널 수 있다.
 *
 * ⚠️ 모듈 변수를 쓰므로 테스트마다 `resetModules`로 새로 불러온다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = typeof import("../session-store");

/** Node에는 sessionStorage가 없다 — 「막힌 인앱 브라우저」와 같은 상태다 */
function unsetStorage(): void {
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
}

function setStorage(impl: Partial<Storage>): void {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = impl;
}

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import("../session-store");
}

beforeEach(unsetStorage);
afterEach(unsetStorage);

describe("세션 통로", () => {
  it("스토리지가 없어도 같은 탭 안에서는 세션이 건너간다", async () => {
    const s = await freshStore();
    s.keepSession("sealed-token");
    expect(s.takeSession()).toBe("sealed-token");
  });

  it("스토리지가 예외를 던져도 마찬가지다 — 인앱 브라우저가 막는 형태", async () => {
    setStorage({
      setItem: () => { throw new Error("blocked"); },
      getItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    const s = await freshStore();
    s.keepSession("sealed-token");
    expect(s.takeSession()).toBe("sealed-token");
  });

  it("스토리지가 살아 있으면 그쪽을 먼저 쓴다 — 새로고침을 견디는 건 이쪽뿐이다", async () => {
    const bag = new Map<string, string>();
    setStorage({
      setItem: (k: string, v: string) => void bag.set(k, v),
      getItem: (k: string) => bag.get(k) ?? null,
      removeItem: (k: string) => void bag.delete(k),
    });
    const s = await freshStore();
    s.keepSession("sealed-token");

    expect(bag.get("precase.session")).toBe("sealed-token");
    // 저장된 값이 우선인지 확인 — 메모리 사본과 다른 값을 심어 본다
    bag.set("precase.session", "restored-token");
    expect(s.takeSession()).toBe("restored-token");
  });

  it("버릴 때는 메모리 사본까지 지운다 — 한쪽만 지우면 만료된 세션이 되살아난다", async () => {
    const s = await freshStore();
    s.keepSession("sealed-token");
    s.dropSession();
    expect(s.takeSession()).toBeNull();
  });

  it("아무것도 넣지 않았으면 null이다", async () => {
    const s = await freshStore();
    expect(s.takeSession()).toBeNull();
  });
});

/**
 * 판단은 90초와 모델 호출을 쓰고 일일 상한(N-203)을 깎는다. 그래서 **누가
 * 판단을 시작해도 되는지**를 여기서 가른다. 새로고침으로 다시 뜬 화면이 아무
 * 설명 없이 다시 돌리면, 결과를 읽다 새로고침한 사람은 왜 처음 화면으로
 * 돌아갔는지 알 수 없다 (T-5 · EX-403).
 */
describe("판단 화면 진입 경로", () => {
  it("상담을 마치고 넘어온 진입은 HANDOFF다 — 바로 돌려도 된다", async () => {
    const s = await freshStore();
    s.keepSession("sealed-token");
    expect(s.takeEntry()).toEqual({ kind: "HANDOFF", token: "sealed-token" });
  });

  it("HANDOFF는 한 번만이다 — 뒤로·앞으로로 다시 들어와도 자동 실행 대상이 아니다", async () => {
    const s = await freshStore();
    s.keepSession("sealed-token");
    s.takeEntry();
    expect(s.takeEntry()).toEqual({ kind: "RESTORED", token: "sealed-token" });
  });

  it("새로고침은 RESTORED다 — 세션은 살아 있지만 자동으로 돌리지 않는다", async () => {
    // 새로고침 = JS 컨텍스트가 새로 뜬다. 스토리지에만 토큰이 남은 상태
    const bag = new Map<string, string>([["precase.session", "sealed-token"]]);
    setStorage({
      setItem: (k: string, v: string) => void bag.set(k, v),
      getItem: (k: string) => bag.get(k) ?? null,
      removeItem: (k: string) => void bag.delete(k),
    });
    const s = await freshStore();
    expect(s.takeEntry()).toEqual({ kind: "RESTORED", token: "sealed-token" });
  });

  it("세션이 없으면 NONE이다", async () => {
    const s = await freshStore();
    expect(s.takeEntry()).toEqual({ kind: "NONE" });
  });

  it("세션을 버리면 HANDOFF 표시도 함께 내린다", async () => {
    const s = await freshStore();
    s.keepSession("sealed-token");
    s.dropSession();
    expect(s.takeEntry()).toEqual({ kind: "NONE" });
  });

  it("재상담으로 READY가 다시 오면 HANDOFF가 다시 선다 (F-308)", async () => {
    const s = await freshStore();
    s.keepSession("first");
    s.takeEntry();
    s.keepSession("second");
    expect(s.takeEntry()).toEqual({ kind: "HANDOFF", token: "second" });
  });
});

describe("유보 이어가기 운반 (F-308 확장 · R-07 ①)", () => {
  it("세션과 필요 자료 목록이 함께 건너간다 — 읽으면 지운다 (단발)", async () => {
    const bag = new Map<string, string>();
    setStorage({
      setItem: (k: string, v: string) => void bag.set(k, v),
      getItem: (k: string) => bag.get(k) ?? null,
      removeItem: (k: string) => void bag.delete(k),
    });
    const s = await freshStore();
    s.keepReconsult("sealed-after-judgment", ["해피콜 녹취"]);
    expect(s.takeReconsult()).toEqual({ token: "sealed-after-judgment", needed: ["해피콜 녹취"] });
    // 남겨 두면 나중에 홈에서 새 상담을 열 때 이어가기로 잘못 부팅한다
    expect(s.takeReconsult()).toBeNull();
    expect(bag.has("precase.reconsult")).toBe(false);
  });

  it("스토리지가 막혀도 메모리 사본으로 소프트 내비게이션은 건넌다 (N-701)", async () => {
    const s = await freshStore();
    s.keepReconsult("sealed-after-judgment", ["상품설명서"]);
    expect(s.takeReconsult()).toEqual({ token: "sealed-after-judgment", needed: ["상품설명서"] });
    expect(s.takeReconsult()).toBeNull();
  });

  it("깨진 저장값은 무시하고 메모리 사본으로 내려간다", async () => {
    const bag = new Map<string, string>([["precase.reconsult", "{망가진 json"]]);
    setStorage({
      setItem: (k: string, v: string) => void bag.set(k, v),
      getItem: (k: string) => bag.get(k) ?? null,
      removeItem: (k: string) => void bag.delete(k),
    });
    const s = await freshStore();
    expect(s.takeReconsult()).toBeNull();
  });

  it("세션을 버리면 재진입 운반도 함께 지운다", async () => {
    const s = await freshStore();
    s.keepReconsult("sealed-after-judgment", ["녹취"]);
    s.dropSession();
    expect(s.takeReconsult()).toBeNull();
  });
});
