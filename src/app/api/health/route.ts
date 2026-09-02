/**
 * GET /api/health — N-302 헬스체크.
 *
 * 감시자(D-4에서 붙일 5분 주기)가 읽는다. 여기서 보는 것은 **의존성 도달성**
 * 3종(DB·법제처·Claude)이고, 명세가 함께 요구하는 **정적 화면·데모 열람 경로는
 * 감시자가 `/`와 데모 URL을 직접 조회**해 확인한다 (health.ts 주석 참조).
 *
 * 상태 코드: ok·degraded → 200 / down → 503.
 * degraded를 200으로 두는 이유는 일부 장애에서도 예방 축(S-02)·검증 결과(S-06)·
 * 데모가 계속 제공되기 때문이다(EX-401·402). 「서비스가 죽었다」고 말하면 거짓이다.
 *
 * ## ?strict=1 — 감시자용 엄격 모드
 *
 * 위 규칙에는 현실적인 문제가 있다. **degraded가 200이라 상태코드만 보는 감시
 * 도구는 그것을 놓친다.** 본문을 파싱하는 감시(키워드 감시)는 흔히 유료 기능이라,
 * 「본문을 읽어라」는 요구가 곧 「유료 감시 도구를 써라」가 된다.
 *
 * 그래서 **옵트인 파라미터**를 둔다. `?strict=1`이면 ok가 아닌 모든 상태를 503으로
 * 돌려준다. 무료 HTTP 감시자도 degraded를 잡을 수 있고, 기본 동작(사람·대시보드가
 * 읽는 경로)의 의미는 그대로다.
 *
 * 감시자는 `/api/health?strict=1`을 보고, 사람은 `/api/health`를 본다.
 */

import { runHealthChecks } from "@/lib/ops/health";
import { jsonNoStore } from "@/lib/ops/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const report = await runHealthChecks();
  // 엄격 모드에서는 degraded도 실패로 본다 (위 주석 참조).
  const strict = new URL(req.url).searchParams.get("strict") === "1";
  const failed = strict ? report.status !== "ok" : report.status === "down";
  return jsonNoStore(report, failed ? 503 : 200);
}
