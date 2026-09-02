/**
 * POST /api/event — DR-302 익명 카운터 증가.
 *
 * 본문: `{ event: "RECONSULT_ENTRY" | "DEMO_VIEWED" }`
 *
 * **클라이언트가 올릴 수 있는 이벤트는 2종뿐이다.** `JUDGMENT_DONE`·`WITHHELD`는
 * 판단 파이프라인이, `REPORT_SUBMITTED`는 신고 라우트가 서버에서 올린다. 브라우저가
 * 판단 완료 수를 올릴 수 있으면 KPI가 측정값이 아니게 된다.
 *
 * 세션 ID·IP·슬롯은 받지 않는다. 받을 필드가 이벤트 이름 하나뿐인 것이 DR-302의
 * "이 카운터로 개인 세션을 재구성할 수 없어야 한다"의 구현이다.
 */

import { bumpCounter, isClientCounterEvent } from "@/lib/ops/counters";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { gate } from "@/lib/ops/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const throttled = gate(req, "REQUEST");
  if (throttled) return throttled;

  const body = await readJson(req, 1024);
  if (!body.ok) return body.response;

  const event = str(body.value, "event");
  if (!isClientCounterEvent(event)) {
    // 어떤 값이 왔는지는 응답에 싣지 않는다
    return jsonNoStore({ ok: false, error: "UNSUPPORTED_EVENT" }, 400);
  }

  // 실패해도 사용자 흐름을 막지 않는다. 반영 여부만 알린다
  const recorded = await bumpCounter(event);
  return jsonNoStore({ ok: true, recorded });
}
