/**
 * NDJSON 스트리밍 응답 — 한 줄에 이벤트 하나.
 *
 * SSE(text/event-stream) 대신 NDJSON을 쓰는 이유: 이벤트가 서버→클라이언트
 * 단방향이고 재연결·이벤트 ID가 필요 없다. 줄 단위 JSON이면 클라이언트가
 * `TextDecoder` + split("\n")만으로 읽으며, **중간 프록시가 SSE를 버퍼링하는
 * 사고**(인앱 브라우저에서 실제로 겪는 흔한 문제)를 피하는 데도 유리하다.
 *
 * 압축·버퍼링 방지 헤더를 명시한다 — 버퍼링되면 스트리밍의 의미가 없어진다.
 */

import "server-only";

export function ndjsonStream(events: AsyncGenerator<unknown>): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch {
        // 생성기가 던지면 스트림을 닫는다. 예외 내용은 싣지 않는다 (N-403)
        controller.close();
      }
    },
    async cancel() {
      // 이용자가 창을 닫으면 파이프라인도 멈춘다 — 남은 모델 호출을 태우지 않는다
      await events.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // 프록시 버퍼링 방지 (nginx 계열이 중간에 있을 때)
      "X-Accel-Buffering": "no",
    },
  });
}
