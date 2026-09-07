import "server-only";
import { createHash } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type postgres from "postgres";
import { callStructured, type StructuredCallOptions, type ModelUsageReceipt } from "@/lib/agents/model";
import { FINSHIELD_MODEL } from "./manifest";

export type ModelBudgetContext = { sql: ReturnType<typeof postgres>; ownerId?: string; caseId?: string;
  runId?: string; inputId?: string; demoRunId?: string; aftercareJobId?: string };
export type ModelUsage = { inputTokens: number; outputTokens: number; costMicrounits: number; unknownCalls: number };
export const emptyModelUsage = (): ModelUsage => ({ inputTokens: 0, outputTokens: 0, costMicrounits: 0, unknownCalls: 0 });

// 2026-09-07 공식 가격표 확인. USD 1 = 1,000,000 microunits. 캐시를 요청하지 않는다.
// https://platform.claude.com/docs/en/about-claude/pricing
export const MODEL_PRICING_VERSION = "sonnet5-usd-20260907";
export function modelCost(usage: ModelUsageReceipt["usage"]) {
  // 캐시 쓰기가 보고되면 TTL별 비용이 필요하다. 알 수 없는 값을 무료로 정산하지 않는다.
  if (usage.cache_creation_input_tokens) throw new Error("UNEXPECTED_CACHE_CREATION");
  return Math.ceil(usage.input_tokens * 2 + usage.output_tokens * 10 + (usage.cache_read_input_tokens ?? 0) * 0.2);
}

/** N-OPS-003·SEC-OPS-003: 호출 전 예약, 응답 거절/형식 실패도 정산, 불명확한 실패는 예약 유지. */
export async function callFinshieldModel<T extends z.ZodType>(opts: StructuredCallOptions<T>,
  context?: ModelBudgetContext, totals = emptyModelUsage()): Promise<z.infer<T>> {
  if (!context) {
    // 단위 시험은 주입된 모델 경계만 검사한다. 실제 실행은 반드시 DB 문맥을 가져야 한다.
    if (process.env.NODE_ENV === "test" && process.env.PRECASE_CI === "1") return callStructured({ ...opts, skipLegacyMeter: true });
    throw new Error("MODEL_BUDGET_CONTEXT_REQUIRED");
  }
  if (opts.model !== FINSHIELD_MODEL) throw new Error("MODEL_PRICING_NOT_REGISTERED");
  const estimatedInput = Buffer.byteLength(opts.system + opts.user + JSON.stringify(zodOutputFormat(opts.schema))) + 4096;
  const estimated = estimatedInput * 2 + (opts.maxTokens ?? 8000) * 10;
  opts.signal?.throwIfAborted();
  const { sql } = context;
  if (context.aftercareJobId && (!context.ownerId || !context.caseId || context.runId || context.inputId || context.demoRunId)) {
    throw new Error("AFTERCARE_BUDGET_CONTEXT_REJECTED");
  }
  const reservation = context.aftercareJobId
    ? sql`select private.reserve_precase_usage(${context.ownerId ?? null}::uuid,${context.caseId ?? null}::uuid,${context.aftercareJobId}::uuid,
        'anthropic',${FINSHIELD_MODEL},${MODEL_PRICING_VERSION},${estimated}::bigint) as id`
    : sql`select private.reserve_finshield_model_usage(
    ${context.ownerId ?? null}::uuid,${context.caseId ?? null}::uuid,${context.inputId ?? null}::uuid,
    ${context.runId ?? null}::uuid,${context.demoRunId ?? null}::uuid,
    ${FINSHIELD_MODEL},${MODEL_PRICING_VERSION},${estimated}::bigint) as id`;
  const [reserved] = await reservation.catch(error => {
      if (["BUDGET_EXCEEDED", "BUDGET_LIMIT_MISSING"].includes(String(error.hint))) {
        throw Object.assign(new Error("MODEL_BUDGET_BLOCKED"), { code: "MODEL_BUDGET_BLOCKED" });
      }
      throw error;
    });
  const reservationId = reserved.id as string;
  let sent = false, settled = false;
  try {
    opts.signal?.throwIfAborted();
    sent = true;
    return await callStructured({ ...opts, skipLegacyMeter: true, onUsage: async receipt => {
      const cost = modelCost(receipt.usage);
      totals.inputTokens += receipt.usage.input_tokens + (receipt.usage.cache_read_input_tokens ?? 0);
      totals.outputTokens += receipt.usage.output_tokens;
      totals.costMicrounits += cost;
      const usage = { ...receipt.usage, elapsed_ms: receipt.elapsedMs, status_category: receipt.statusCategory,
        retry_count: 0, provider_request_ref: createHash("sha256").update(receipt.requestId).digest("hex") };
      await sql`select id from private.settle_usage_budget(${reservationId}::uuid,${cost}::bigint,${JSON.stringify(usage)}::text::jsonb)`;
      settled = true;
    } });
  } catch (error) {
    if (!settled) {
      const status = (error as { status?: number }).status;
      if (!sent || [400,401,403,404,413,429].includes(status ?? 0)) {
        await sql`select private.release_usage_budget(${reservationId}::uuid,'PROVIDER_NOT_BILLED')`;
      } else {
        totals.unknownCalls += 1;
        await sql`select private.flag_usage_reconciliation(${reservationId}::uuid,'PROVIDER_RESULT_UNKNOWN')`;
      }
    }
    throw error;
  }
}
