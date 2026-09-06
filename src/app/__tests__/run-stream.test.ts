import { describe, expect, it, vi } from "vitest";
import { readRunStream } from "../run-stream";

function responseWith(chunks: Uint8Array[], cancel = vi.fn()) {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); },
    cancel,
  }));
}

describe("검증 응답 스트림", () => {
  it("한글의 바이트 경계와 여러 청크에 걸친 이벤트를 복원한다", async () => {
    const bytes = new TextEncoder().encode('{"type":"stage","message":"확인 중"}\n{"type":"done"}\n');
    const lines: string[] = [];
    const cancel = vi.fn();
    await readRunStream(responseWith([...bytes].map((byte) => Uint8Array.of(byte)), cancel), (line) => lines.push(line));
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: "stage", message: "확인 중" }, { type: "done" },
    ]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("마지막 개행 없이 끝난 완료 이벤트도 처리한다", async () => {
    const onLine = vi.fn();
    await readRunStream(new Response('{"type":"done"}'), onLine);
    expect(onLine).toHaveBeenCalledWith('{"type":"done"}');
  });

  it("진행 이벤트 뒤 연결이 끝나면 오류를 반환한다", async () => {
    await expect(readRunStream(new Response('{"type":"agent_started"}\n'), vi.fn()))
      .rejects.toThrow("완료 전에 연결이 종료됐습니다");
  });

  it.each(["error", "blocked"])("%s 이벤트에서 대기를 마친다", async (type) => {
    const cancel = vi.fn();
    await readRunStream(responseWith([new TextEncoder().encode(JSON.stringify({ type }) + "\n")], cancel), vi.fn());
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("잘못된 응답은 오류를 반환하고 읽기를 정리한다", async () => {
    const cancel = vi.fn();
    await expect(readRunStream(responseWith([new TextEncoder().encode("not-json\n")], cancel), vi.fn())).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("완료 뒤 같은 청크에 붙은 이벤트가 결과를 덮어쓰지 않는다", async () => {
    const onLine = vi.fn();
    await readRunStream(new Response('{"type":"done"}\n{"type":"error"}\n'), onLine);
    expect(onLine).toHaveBeenCalledOnce();
  });

  it("본문이 없으면 즉시 실패한다", async () => {
    await expect(readRunStream(new Response(null), vi.fn())).rejects.toThrow("응답 본문이 없습니다");
  });
});
