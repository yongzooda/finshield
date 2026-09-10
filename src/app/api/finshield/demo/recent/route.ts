/**
 * GET /api/finshield/demo/recent — 가장 최근에 성공한 실제 공개 실행 결과 (S-001).
 *
 * 공개 실행 상한에 걸린 방문자가 빈 화면만 보지 않게 한다. 과거의 실제 실행 기록을
 * 실행 시각과 함께 돌려준다. 사전 계산 결과나 부분 실행은 돌려주지 않고, 이 응답을
 * 새 실행으로 세지 않는다. Seed 는 합성 문장뿐이라 방문자 정보가 들어 있지 않다.
 */

import { jsonNoStore } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { readRecentResult } from "@/lib/finshield/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const recent = await readRecentResult(fsql());
    if (!recent) return jsonNoStore({ error: "아직 표시할 최근 실행 결과가 없습니다" }, 404);
    return jsonNoStore({ ...recent.manifest, mode: "RECENT_LIVE", is_precomputed: false, computed_at: recent.computedAt });
  } catch {
    return jsonNoStore({ error: "최근 실행 결과를 읽지 못했습니다" }, 503);
  }
}
