/**
 * POST /api/report — F-404 오류 신고 접수 (DR-301).
 *
 * 본문: `{ content: string, issueCode?: string, channel?: string }`
 *
 * 접수 전 **마스킹을 강제**하고(F-601), 지우지 못한 개인정보가 의심되면 저장하지
 * 않고 400으로 되돌린다. 판단 결과·세션과 연결하는 식별자는 받지 않는다 —
 * 받아봐야 넣을 컬럼이 없다(P-604).
 */

import { env } from "@/lib/env";
import { bumpCounter } from "@/lib/ops/counters";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { gate } from "@/lib/ops/rate-limit";
import { submitReport } from "@/lib/ops/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const throttled = gate(req, "REQUEST");
  if (throttled) return throttled;

  const body = await readJson(req);
  if (!body.ok) return body.response;

  const result = await submitReport(
    {
      content: str(body.value, "content") ?? "",
      issueCode: str(body.value, "issueCode"),
      channel: str(body.value, "channel"),
    },
    { maxChars: env.MAX_STATEMENT_CHARS },
  );

  if (!result.ok) {
    const status = result.reason === "DB" ? 503 : 400;
    return jsonNoStore({ ok: false, reason: result.reason, ask: result.ask }, status);
  }

  // 접수가 끝난 뒤에 센다. 카운터 실패가 접수를 되돌리지 않는다 (DR-302는 관측 수단이다)
  await bumpCounter("REPORT_SUBMITTED");

  return jsonNoStore(
    {
      ok: true,
      id: result.id,
      /** 화면이 "무엇을 가리고 접수했는지" 보여줄 수 있게 건수만 돌려준다 (가린 값 자체는 돌려주지 않는다) */
      maskedCount: result.masked.total,
      droppedIssueCode: result.droppedIssueCode,
      droppedChannel: result.droppedChannel,
    },
    201,
  );
}
