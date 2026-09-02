/**
 * 스트리밍 골격 검증 — 모델을 부르지 않는 부분만 본다.
 * 실소요·연결 유지 실측은 `pipeline-stream-live.test.ts`와 프로덕션 probe의 몫이다.
 */

import { describe, expect, it } from "vitest";
import { ndjsonStream } from "../ndjson";

async function lines(res: Response): Promise<string[]> {
  const text = await res.text();
  return text.split("\n").filter(Boolean);
}

describe("NDJSON 스트림", () => {
  it("이벤트 하나가 한 줄이다", async () => {
    async function* g() {
      yield { type: "a", n: 1 };
      yield { type: "b", n: 2 };
    }
    const rows = (await lines(ndjsonStream(g()))).map((l) => JSON.parse(l));
    expect(rows).toEqual([
      { type: "a", n: 1 },
      { type: "b", n: 2 },
    ]);
  });

  it("버퍼링·캐시를 막는 헤더를 붙인다 — 없으면 스트리밍이 의미를 잃는다", () => {
    async function* g() {
      yield { ok: true };
    }
    const res = ndjsonStream(g());
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Cache-Control")).toContain("no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("생성기가 던져도 스트림을 닫을 뿐 예외 내용을 싣지 않는다 (N-403)", async () => {
    async function* g() {
      yield { type: "first" };
      throw new Error("슬롯 값이 섞인 내부 메시지");
    }
    const text = await ndjsonStream(g()).text();
    expect(text).toContain("first");
    expect(text).not.toContain("슬롯 값이 섞인");
  });

  it("이용자가 끊으면 파이프라인도 멈춘다 — 남은 모델 호출을 태우지 않는다", async () => {
    let cleanedUp = false;
    async function* g() {
      try {
        yield { type: "first" };
        yield { type: "second" };
      } finally {
        cleanedUp = true;
      }
    }
    const res = ndjsonStream(g());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(cleanedUp).toBe(true);
  });
});

describe("판단 파이프라인 — 모델 이전 단계", () => {
  it("슬롯이 덜 찼으면 모델을 부르지 않고 되돌린다", async () => {
    const { runJudgment } = await import("../../agents/pipeline");
    const { createSession } = await import("../../agents/session");

    const s = createSession();
    s.slots = { channel: "TM" }; // 필수 5종 중 하나뿐

    const events = [];
    for await (const e of runJudgment(s)) events.push(e);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", code: "SLOTS_INCOMPLETE" });
  });

  it("슬롯이 다 차도 정제 사실관계가 없으면 진행하지 않는다", async () => {
    const { runJudgment } = await import("../../agents/pipeline");
    const { createSession } = await import("../../agents/session");

    const s = createSession();
    s.slots = {
      channel: "TM", age: 67, product: "INS_WHOLE",
      contract_ym: "2019-05", traits: ["ELDER"],
    };
    s.facts = null;

    const events = [];
    for await (const e of runJudgment(s)) events.push(e);
    expect(events[0]).toMatchObject({ type: "error", code: "SLOTS_INCOMPLETE" });
  });
});
