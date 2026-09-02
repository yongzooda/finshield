/**
 * POST /api/judge — 판단 파이프라인 (② 조사 → ③ 판단 → ④ 안내) 스트리밍.
 *
 * 본문: `{ sessionId: string }`. 확정 슬롯·정제 사실관계는 **세션 안에만** 있고
 * 요청 본문으로 오가지 않는다 (DR-4xx · SR-402).
 *
 * `maxDuration`은 Vercel Hobby 상한인 300초에 맞춘다. 판단 P95는 120초(N-103)라
 * 여유가 있지만, 도구 재시도가 겹치는 꼬리 구간까지 끊기지 않게 상한을 둔다.
 */

import { openSession, sealSession } from "@/lib/agents/session";
import { runJudgment } from "@/lib/agents/pipeline";
import { budgetState, QUOTA_EXCEEDED_MESSAGE } from "@/lib/ops/budget";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { gate } from "@/lib/ops/rate-limit";
import { ndjsonStream } from "@/lib/ops/ndjson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  // 봉인 토큰에 진술·슬롯·로그가 담겨 있어 본문이 커진다
  // N-203 — 판단은 이 서비스에서 가장 비싼 호출이라 일 단위 상한을 따로 건다
  const throttled = gate(req, "REQUEST") ?? gate(req, "JUDGMENT");
  if (throttled) return throttled;

  const body = await readJson(req, 256 * 1024);
  if (!body.ok) return body.response;

  const token = str(body.value, "session");
  if (!token) return jsonNoStore({ ok: false, error: "SESSION_REQUIRED" }, 400);

  // EX-404 — 판단 한 번이 이 서비스에서 가장 비싼 호출이다(도구 8~10회 +
  // 고효율 추론, 실측 약 100초). 시작 전에 막지 않으면 도중에 소진된다.
  const budget = await budgetState();
  if (!budget.allowed) {
    return jsonNoStore({ ok: false, error: "QUOTA", message: QUOTA_EXCEEDED_MESSAGE }, 503);
  }

  const found = openSession(token);
  if (!found.ok) {
    // 만료·소멸은 오류가 아니라 설계 동작이다. 안내 문구는 **세션 모듈이 정본**을
    // 갖고 있다 — 라우트가 따로 쓰면 화면마다 다른 말을 하게 된다.
    // 이용자에게는 만료와 미존재를 구분해 보이지 않는다(session.ts 참조).
    return jsonNoStore({ ok: false, error: found.reason, message: found.message }, 410);
  }

  // done에 실을 재봉인 (F-308 확장) — 마스킹 진술은 라우트만 갖고 있어 여기서 닫는다
  return ndjsonStream(
    runJudgment(found.session, () => sealSession(found.session, found.maskedStatement)),
  );
}
