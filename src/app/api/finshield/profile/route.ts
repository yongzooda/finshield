/**
 * GET·PUT /api/finshield/profile — 금융 프로필 (S-004).
 *
 * 프로필은 사용자 것이다. worker 역할은 이 표에 손대지 못한다. 그래서 읽기와
 * 쓰기 모두 사용자의 token 을 그대로 실어 넘기고 정책이 소유권을 판단한다.
 *
 * 저장한 값은 이후 Case 를 만들 때 Snapshot 으로 굳는다. 지금 고쳐도 이미 나온
 * Passport 는 바뀌지 않는다 (AUTH-008).
 */

import { jsonNoStore, readJson } from "@/lib/ops/http";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { restSelect, restUpsert, RestError } from "@/lib/finshield/rest";
import {
  PROFILE_SCHEMA_VERSION, completenessOf, normalizeProfile, type ProfileValues,
} from "@/lib/finshield/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = "id,schema_version,income_band,debt_burden_band,emergency_fund_band,"
  + "purpose_code,horizon_code,liquidity_need,loss_tolerance,completeness,revision_no,updated_at";

export async function GET(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  try {
    // RLS 소유권 검사와 별도로 발급처에서 현재 세션이 살아 있는지 확인한다.
    await resolveOwner(request);
    const rows = await restSelect({ token, path: "financial_profiles", query: { select: SELECT, limit: "1" } });
    return jsonNoStore({ profile: rows[0] ?? null }, 200);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}

export async function PUT(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return jsonNoStore({ error: "로그인이 필요합니다" }, 401);
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const values: ProfileValues | null = normalizeProfile(parsed.value);
  if (!values) return jsonNoStore({ error: "고를 수 없는 값이 있습니다" }, 400);

  try {
    // 판을 세는 값은 지금 저장된 값에서 이어 간다.
    const current = await restSelect({
      token, path: "financial_profiles", query: { select: "revision_no", limit: "1" },
    });
    const revision = Number((current[0] as { revision_no?: unknown } | undefined)?.revision_no ?? 0);
    const rows = await restUpsert({
      token,
      path: "financial_profiles",
      onConflict: "owner_id",
      row: {
        owner_id: ownerId,
        schema_version: PROFILE_SCHEMA_VERSION,
        ...values,
        completeness: completenessOf(values),
        revision_no: Number.isFinite(revision) && revision > 0 ? revision + 1 : 1,
        updated_at: new Date().toISOString(),
      },
    });
    return jsonNoStore({ profile: rows[0] ?? null }, 200);
  } catch (error) {
    if (error instanceof RestError) return jsonNoStore({ error: error.message }, error.status);
    throw error;
  }
}
