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
  AFTERCARE_SCHEMA_VERSION, aftercareAction, normalizeAnswers,
} from "@/lib/finshield/aftercare";

import { z } from "zod";
import { createHash } from "node:crypto";
import { start } from "workflow/api";
import { aftercareWorkflow } from "@/lib/finshield/workflows/aftercare";
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
  const operation = z.object({ operation: z.enum(["RESUME", "CANCEL"]), job_id: z.uuid() }).safeParse(parsed.value);
  if (operation.success) {
    const { job_id: jobId } = operation.data;
    try {
      if (operation.data.operation === "CANCEL") {
        await fsql()`select private.stop_precase_reviews(${ownerId}::uuid,${id}::uuid,${jobId}::uuid)`;
      } else {
        const [dispatch] = await fsql()`select private.claim_precase_dispatch(${ownerId}::uuid,${id}::uuid,${jobId}::uuid) as ok`;
        if (dispatch.ok) await start(aftercareWorkflow, [jobId]);
      }
      return jsonNoStore({ status: "STATUS_RELOAD_REQUIRED" });
    } catch { return jsonNoStore({ error: "점검 요청을 확인하지 못했습니다. 상태를 다시 확인해 주세요." }, 503); }
  }
  const answers = normalizeAnswers((parsed.value as { answers?: unknown })?.answers);
  if (!answers) return jsonNoStore({ error: "고를 수 없는 답이 있습니다" }, 400);
  if (Object.keys(answers).length === 0) {
    return jsonNoStore({ error: "한 항목 이상 답해 주세요" }, 400);
  }

  const sql = fsql();
  const body = parsed.value as { base_passport_id?: unknown; contract_terms?: unknown; request_key?: unknown };
  const requestKey = z.uuid().safeParse(body.request_key);
  if (!requestKey.success) return jsonNoStore({ error: "점검 요청을 새로 확인해 주세요" }, 400);
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
  passport.claims.sort((a, b) => a.claim_id.localeCompare(b.claim_id));
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

  const manifest = await loadManifest(sql);
  const input = { schema_version: "aftercare-review-v1", answers: storedAnswers, comparison };
  const hash = createHash("sha256").update(JSON.stringify({ passportId, input, manifest: manifest.manifestId })).digest("hex");
  try {
    const [job] = await sql`select private.enqueue_precase_review(${ownerId}::uuid,${id}::uuid,${passportId}::uuid,
      ${manifest.manifestId}::uuid,${requestKey.data}::uuid,${hash},${JSON.stringify(input)}::text::jsonb) as id`;
    const [dispatch] = await sql`select private.claim_precase_dispatch(${ownerId}::uuid,${id}::uuid,${job.id}::uuid) as ok`;
    if (dispatch.ok) {
      try { await start(aftercareWorkflow, [job.id as string]); }
      catch { return jsonNoStore({ review_job_id: job.id, error: "점검 예약 응답을 확인하지 못했습니다. 같은 요청으로 이어서 처리해 주세요." }, 503); }
    }
    return jsonNoStore({ review_job_id: job.id, base_passport_id: passportId, status: "ACCEPTED" }, 202);
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "");
    if (code === "42501") return jsonNoStore({ error: "이 Case 또는 기준 Passport를 찾을 수 없습니다" }, 404);
    if (["23514", "55000"].includes(code)) return jsonNoStore({ error: "가입 등록과 진행 중인 점검을 확인해 주세요. 같은 요청의 내용은 바꿀 수 없습니다." }, 409);
    return jsonNoStore({ error: "점검 접수를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요." }, 503);
  }
}


/** PC-002: 최신 검증본이 바뀌어도 점검 당시의 기준 Passport·답변·문구 비교를 복원한다. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ownerId = await resolveOwner(request);
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonNoStore({ error: "잘못된 주소입니다" }, 400);
    const requestedJob = new URL(request.url).searchParams.get("job_id");
    if (requestedJob && !UUID.test(requestedJob)) return jsonNoStore({ error: "잘못된 점검 주소입니다" }, 400);
    const token = bearerToken(request)!;
    const cases = await restSelect({ token, path: "financial_cases", query: { select: "id", id: `eq.${id}`, limit: "1" } });
    if (!cases.length) return jsonNoStore({ error: "이 기록을 찾을 수 없습니다" }, 404);
    await fsql()`select private.stop_precase_reviews(${ownerId}::uuid,${id}::uuid,null::uuid)`;
    const jobs = await restSelect({ token, path: "precase_review_jobs", query: {
      select: "id,status,assessment_id,base_passport_id,request_key,input_masked,agent_trace,reason_code,deadline_at",
      case_id: `eq.${id}`, order: "created_at.desc", limit: "1",
      ...(requestedJob ? { id: `eq.${requestedJob}` } : {}),
    } });
    const reviewJob = jobs[0] ? z.object({ id: z.uuid(), status: z.string(), assessment_id: z.uuid().nullable() }).passthrough().parse(jobs[0]) : null;
    if (requestedJob && !reviewJob) return jsonNoStore({ error: "이 점검을 찾을 수 없습니다" }, 404);
    const assessments = z.array(z.object({id:z.uuid(),assessment_no:z.number(),base_passport_id:z.uuid(),result:z.string(),summary_masked:z.string(),finished_at:z.string(),assessment_schema_version:z.string()})).parse(await restSelect({ token, path: "precase_assessments", query: {
      select: "id,assessment_no,base_passport_id,result,summary_masked,finished_at,assessment_schema_version",
      case_id: `eq.${id}`, status: "in.(COMPLETED,PARTIAL)", order: "assessment_no.desc", limit: "1",
      ...(typeof reviewJob?.assessment_id === "string" ? { id: `eq.${reviewJob.assessment_id}` } : {}),
    } }));
    const assessment = assessments[0];
    if (!assessment) return jsonNoStore({ assessment: null, review_job: reviewJob });
    const [answerRows, actionRows] = await Promise.all([
      restSelect({ token, path: "precase_answers", query: { select: "question_code,answer_code,answer_text_masked",
        precase_assessment_id: `eq.${assessment.id}`, order: "answer_version_no.asc" } }).then(rows => z.array(z.object({question_code:z.string(),answer_code:z.string().nullable(),answer_text_masked:z.string().nullable()})).parse(rows)),
      restSelect({ token, path: "action_checklists", query: { select: "action_code,required_material_codes,official_channel_registry_id",
        precase_assessment_id: `eq.${assessment.id}` } }).then(rows => z.array(z.object({action_code:z.string(),required_material_codes:z.array(z.string()),official_channel_registry_id:z.uuid().nullable()})).parse(rows)),
    ]);
    const answers: Record<string, string> = {};
    const comparison = [];
    for (const row of answerRows) {
      // CONTRACT_MATCHES_EXPLANATION은 설문 답변이며 Claim 문구 비교가 아니다.
      if (/^CONTRACT_[0-9A-F]{32}$/.test(row.question_code)) {
        try {
          const value = comparisonSchema.safeParse(JSON.parse(String(row.answer_text_masked)));
          if (value.success && row.question_code === `CONTRACT_${value.data.claim_id.replaceAll("-", "").toUpperCase()}`) comparison.push(value.data);
        } catch { /* 과거 형식의 본문을 추측해서 새 비교로 만들지 않는다. */ }
      } else answers[String(row.question_code)] = String(row.answer_code);
    }
    const channels = await fsql()`select id,display_value from kb.official_channel_registry
      where id = any(${actionRows.map(row => row.official_channel_registry_id).filter((value): value is string => Boolean(value))}::uuid[])`;
    return jsonNoStore({ review_job: reviewJob, assessment: {
      assessment_id: assessment.id, assessment_no: assessment.assessment_no, finished_at: assessment.finished_at,
      base_passport_id: assessment.base_passport_id, result: assessment.result,
      reasons: [assessment.summary_masked], answers: normalizeAnswers(answers) ?? {}, comparison,
      actions: actionRows.map(row => ({
        ...(aftercareAction(String(row.action_code)) ?? { action_code: row.action_code, label: "저장된 점검 행동", detail: "" }),
        required_material_codes: row.required_material_codes,
        official_channel: channels.find(channel => channel.id === row.official_channel_registry_id)?.display_value ?? null,
      })),
    } });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    return jsonNoStore({ error: "저장된 점검 결과를 읽지 못했습니다" }, 503);
  }
}

const comparisonSchema = z.object({ claim_id: z.uuid(), before: z.string(), contract: z.string(),
  result: z.enum(["SAME_TEXT", "DIFFERENT_TEXT", "NOT_PROVIDED"]) });
