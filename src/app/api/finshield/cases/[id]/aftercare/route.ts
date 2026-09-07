/**
 * POST /api/finshield/cases/[id]/aftercare — 가입 후 점검 (S-016).
 *
 * 사용자를 다른 사이트로 보내지 않는다. 같은 Case 안에서 답을 받고 같은 기록에
 * 남긴다 (규칙 6).
 *
 * 판단은 정해진 규칙이 한다. 모델이 결론을 만들지 않는다. 연락처와 신고 창구도
 * 만들지 않고 공식 채널 Registry 에 있는 값만 붙인다 (RES-007).
 *
 * 결과는 덮어쓰지 않는다. 다시 점검하면 다음 판이 쌓인다.
 */

import { jsonNoStore, readJson } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { bearerToken, resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { loadManifest } from "@/lib/finshield/registry";
import {
  AFTERCARE_SCHEMA_VERSION, decideAftercare, normalizeAnswers,
} from "@/lib/finshield/aftercare";

import { z } from "zod";
import { restSelect } from "@/lib/finshield/rest";
import { gateForModel } from "@/lib/agents/pii";
import { compareContractText, type PriorClaim } from "@/lib/finshield/contract-comparison";

const contractSchema = z.record(z.uuid(), z.string().trim().max(400));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const answers = normalizeAnswers((parsed.value as { answers?: unknown })?.answers);
  if (!answers) return jsonNoStore({ error: "고를 수 없는 답이 있습니다" }, 400);
  if (Object.keys(answers).length === 0) {
    return jsonNoStore({ error: "한 항목 이상 답해 주세요" }, 400);
  }

  const sql = fsql();
  const body = parsed.value as { base_passport_id?: unknown; contract_terms?: unknown };
  const requestedPassport = z.uuid().safeParse(body.base_passport_id);
  if (body.base_passport_id !== undefined && !requestedPassport.success) {
    return jsonNoStore({ error: "이전 검증 기록을 다시 선택해 주세요" }, 400);
  }
  const passports = await restSelect({ token: bearerToken(request)!, path: "passport_v", query: {
    select: "passport_id,claims", case_id: `eq.${id}`, order: "passport_version_no.desc", limit: "1",
    ...(requestedPassport.success ? { passport_id: `eq.${requestedPassport.data}` } : {}),
  } });
  if (!passports.length) return jsonNoStore({ error: "먼저 거래 전 확인을 끝내야 점검할 수 있습니다" }, 409);
  const passport = passports[0] as { passport_id: string; claims: (PriorClaim & { status: string })[] };
  const passportId = passport.passport_id;
  const parsedTerms = contractSchema.safeParse(body.contract_terms ?? {});
  if (!parsedTerms.success || Object.keys(parsedTerms.data).some(key => !passport.claims.some(claim => claim.claim_id === key))) {
    return jsonNoStore({ error: "이 기록에 없는 계약 항목이거나 문장이 너무 깁니다" }, 400);
  }
  const terms: Record<string, string> = {};
  for (const [key, text] of Object.entries(parsedTerms.data)) {
    const gate = gateForModel(text);
    if (!gate.ok) return jsonNoStore({ error: "계약 문구에서 개인정보를 지운 뒤 다시 입력해 주세요" }, 400);
    terms[key] = gate.masked.text;
  }
  const comparison = compareContractText(passport.claims, terms);
  const decision = decideAftercare({
    answers, contradictedClaims: passport.claims.filter(claim => claim.status === "CONTRADICTED").length,
    contractTextDifferences: comparison.filter(row => row.result === "DIFFERENT_TEXT").length,
  });
  const storedAnswers = [
    ...Object.entries(answers).map(([code, value]) => ({
      question_code: code, question_version: AFTERCARE_SCHEMA_VERSION, answer_code: value,
    })),
    ...comparison.map(row => ({
      question_code: `CONTRACT_${row.claim_id.replaceAll("-", "").toUpperCase()}`,
      question_version: AFTERCARE_SCHEMA_VERSION, answer_code: row.result,
      answer_text_masked: JSON.stringify(row),
    })),
  ];

  // 공식 창구는 Registry 에서 찾는다. 없으면 붙이지 않고 없다고 적는다.
  const institutions = [...new Set(
    decision.actions.map((action) => action.institution_code).filter((code): code is string => Boolean(code)),
  )];
  const channels = institutions.length === 0 ? [] : await sql`
    select id, institution_code, channel_type, display_value
      from kb.official_channel_registry
     where institution_code in ${sql(institutions)}
       and (valid_to is null or valid_to >= current_date)`;
  const channelOf = (institution?: string, type?: string) =>
    channels.find((row) => row.institution_code === institution && row.channel_type === type);

  const manifest = await loadManifest(sql);
  const actionRows = decision.actions.map((action) => {
    const channel = channelOf(action.institution_code, action.channel_type);
    return {
      action_code: action.action_code,
      required_material_codes: action.required_material_codes,
      official_channel_registry_id: (channel?.id as string | undefined) ?? "",
    };
  });

  try {
    const rows = await sql`
      select private.record_precase_assessment(${ownerId}::uuid, ${id}::uuid,
        ${passportId}::uuid, ${manifest.manifestId}::uuid,
        ${decision.result}::public.aftercare_result, ${decision.summary_masked}::text,
        ${JSON.stringify(storedAnswers)}::text::jsonb,
        ${JSON.stringify(actionRows)}::text::jsonb,
        ${AFTERCARE_SCHEMA_VERSION}) as id`;
    return jsonNoStore({
      assessment_id: rows[0].id,
      base_passport_id: passportId, comparison,
      result: decision.result,
      reasons: decision.reasons,
      actions: decision.actions.map((action) => ({
        ...action,
        official_channel: channelOf(action.institution_code, action.channel_type)?.display_value ?? null,
      })),
    }, 200);
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 Case 를 찾을 수 없습니다" }, 404);
    if (code === "23514") {
      return jsonNoStore({ error: "가입 사실을 먼저 등록해야 점검할 수 있습니다" }, 409);
    }
    throw error;
  }
}
