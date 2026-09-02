/**
 * 운영 API 공통 응답 규약.
 *
 * 세 라우트(신고·이벤트·헬스체크)가 같은 형태로 답하게 모아둔다. 뒤이어 붙을
 * 상담·판단 라우트(S-03·S-04)도 이 규약을 물려받는다.
 *
 * ⚠️ 어떤 응답에도 요청 본문을 되돌려 싣지 않는다. 검증 실패 응답에 "받은 값"을
 * 그대로 붙이는 흔한 관용이 여기서는 진술 원문을 응답·로그로 흘리는 경로가 된다
 * (절대규칙 3 · N-403).
 */

import "server-only";

/** 운영 응답은 캐시하지 않는다 — 헬스체크가 캐시되면 장애를 못 본다 */
export function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export type ReadJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

/**
 * 본문을 크기 상한과 함께 읽는다.
 *
 * 파싱 전에 길이를 먼저 재는 이유는, 거대한 본문을 JSON.parse에 통째로 넘기는
 * 것 자체가 비용이기 때문이다. 상한은 넉넉히 잡되 무제한은 두지 않는다.
 */
export async function readJson<T = unknown>(
  req: Request,
  maxBytes = 64 * 1024,
): Promise<ReadJsonResult<T>> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: jsonNoStore({ error: "BODY_UNREADABLE" }, 400) };
  }

  if (text.length > maxBytes) {
    return { ok: false, response: jsonNoStore({ error: "BODY_TOO_LARGE" }, 413) };
  }

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    // 파싱 실패해도 받은 문자열을 응답에 싣지 않는다
    return { ok: false, response: jsonNoStore({ error: "BAD_JSON" }, 400) };
  }
}

/** 객체에서 문자열 필드만 안전하게 꺼낸다 */
export function str(o: unknown, key: string): string | null {
  if (!o || typeof o !== "object") return null;
  const v = (o as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}
