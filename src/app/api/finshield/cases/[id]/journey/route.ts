/**
 * POST /api/finshield/cases/[id]/journey — 가입·피해 의심 사실 등록 (S-015).
 *
 * 검증 상태와 다른 축이다. 여기서 무엇을 등록해도 이미 나온 검증 결과는 바뀌지
 * 않는다. 반대로 가입하지 않았다고 검증이 취소되지도 않는다 (규칙 6).
 *
 * 피해 의심은 가입 확인 없이도 성립한다. 그래서 가입으로 세지 않는다.
 *
 * 최종 조건 문장은 자유 입력이라 PII Gate 를 먼저 지난다. 잔존이 의심되면
 * 저장하지 않고 되묻는다.
 */

import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { gateForModel } from "@/lib/agents/pii";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["BRANCH", "ONLINE", "PHONE", "AGENT", "OTHER"] as const;
const DAMAGE_REASONS = ["FUNDS_SENT", "PERSONAL_DATA_SENT", "REMOTE_CONTROL_INSTALLED", "OTHER"] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }
  const { id } = await context.params;
  if (!UUID.test(id)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const kind = str(parsed.value, "kind");

  try {
    if (kind === "DAMAGE") {
      const reason = str(parsed.value, "reason_code") ?? "";
      if (!DAMAGE_REASONS.includes(reason as (typeof DAMAGE_REASONS)[number])) {
        return jsonNoStore({ error: "무슨 일이 있었는지 골라 주세요" }, 400);
      }
      const rows = await fsql()`
        select journey_stage, aftercare_status
          from private.record_damage_suspicion(${ownerId}::uuid, ${id}::uuid, ${reason})`;
      return jsonNoStore({ journey_stage: rows[0].journey_stage, aftercare_status: rows[0].aftercare_status }, 200);
    }

    if (kind !== "ENROLLED") return jsonNoStore({ error: "무엇을 등록할지 골라 주세요" }, 400);
    const channel = str(parsed.value, "channel_code") ?? "";
    if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
      return jsonNoStore({ error: "가입 경로를 골라 주세요" }, 400);
    }
    const enrolledOn = str(parsed.value, "enrolled_on");
    if (enrolledOn && !DATE_ONLY.test(enrolledOn)) {
      return jsonNoStore({ error: "가입일 형식이 올바르지 않습니다" }, 400);
    }

    // 최종 조건은 사용자가 직접 적는다. 마스킹을 지나야 저장한다.
    const terms = (str(parsed.value, "final_terms") ?? "").slice(0, 1000);
    let masked: string | null = null;
    if (terms.trim().length > 0) {
      const gate = gateForModel(terms);
      if (!gate.ok) return jsonNoStore({ blocked: true, ask: gate.ask }, 200);
      masked = gate.masked.text;
    }

    const rows = await fsql()`
      select journey_stage, enrollment_confirmed_at
        from private.record_enrollment(${ownerId}::uuid, ${id}::uuid, ${channel},
          ${enrolledOn ?? null}::date, ${masked}::text)`;
    return jsonNoStore({
      journey_stage: rows[0].journey_stage,
      enrollment_confirmed_at: rows[0].enrollment_confirmed_at,
    }, 200);
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 Case 를 찾을 수 없습니다" }, 404);
    if (code === "23514") return jsonNoStore({ error: "입력한 내용을 등록할 수 없습니다" }, 400);
    throw error;
  }
}
