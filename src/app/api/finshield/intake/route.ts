/**
 * POST /api/finshield/intake — 상담 내용을 받아 확인할 Claim 을 돌려준다.
 *
 * 원문은 저장하지 않는다. 비모델 PII Gate 를 먼저 지나고, 잔존이 의심되면 그
 * 자리에서 되묻는다. 통과한 마스킹 문장만 DB 와 모델에 간다.
 *
 * 처리 단계를 NDJSON 으로 흘린다. 가짜 백분율 대신 실제로 끝난 단계만 보낸다
 * (S-007). 무엇을 몇 개 가렸는지는 세어서 보내고 원문은 보내지 않는다.
 *
 * 이 endpoint 는 판단하지 않는다. 무엇을 확인할지 목록을 만들 뿐이고, 사용자가
 * 그 목록을 확정해야 검증이 시작된다 (CLM-003).
 */

import { ndjsonStream } from "@/lib/ops/ndjson";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { fsql } from "@/lib/finshield/db";
import { resolveOwner, UnauthenticatedError } from "@/lib/finshield/auth";
import { startIntake } from "@/lib/finshield/intake";
import { createClaimExtractor } from "@/lib/finshield/agents/model-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 4000;

export async function POST(request: Request): Promise<Response> {
  let ownerId: string;
  try {
    ownerId = await resolveOwner(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) return jsonNoStore({ error: error.message }, 401);
    throw error;
  }

  const parsed = await readJson(request);
  if (!parsed.ok) return jsonNoStore({ error: "요청 형식이 올바르지 않습니다" }, 400);
  const text = str(parsed.value, "text") ?? "";
  if (text.trim().length === 0) return jsonNoStore({ error: "내용을 입력해 주세요" }, 400);
  if (text.length > MAX_CHARS) return jsonNoStore({ error: `${MAX_CHARS}자를 넘을 수 없습니다` }, 400);

  const events: unknown[] = [];
  const waiters: (() => void)[] = [];
  let finished = false;
  const wake = () => { while (waiters.length > 0) waiters.pop()?.(); };
  const push = (event: unknown) => { events.push(event); wake(); };

  const work = (async () => {
    try {
      const result = await startIntake({
        sql: fsql(),
        ownerId,
        rawText: text,
        // 제목도 마스킹된 값만 남긴다. 원문 앞부분을 그대로 쓰지 않는다.
        titleMasked: "대출 권유 검증",
        extractClaims: createClaimExtractor(),
        onStage: (stage, detail) => push({ type: "stage", stage, ...(detail ?? {}) }),
      });

      if (!result.ok) {
        // 잔존이 의심되면 무엇을 지워야 하는지 알려 주고 멈춘다.
        push({ type: "blocked", reason: result.reason, ask: result.ask });
        return;
      }
      push({
        type: "done",
        case_id: result.caseId,
        input_id: result.inputId,
        masked_text: result.maskedText,
        claims: result.claims.map((claim) => ({
          claim_id: claim.claimId,
          expected_revision_no: 1,
          claim_ref: claim.claim_ref,
          claim_type: claim.claim_type,
          statement_masked: claim.statement_masked,
          materiality: claim.materiality,
        })),
      });
    } catch (error) {
      push({ type: "error", message: "접수하지 못했습니다", code: (error as { code?: string })?.code ?? null });
    } finally {
      finished = true;
      wake();
    }
  })();

  async function* stream(): AsyncGenerator<unknown> {
    let index = 0;
    while (!finished || index < events.length) {
      if (index < events.length) { yield events[index]; index += 1; continue; }
      await new Promise<void>((resolve) => { waiters.push(resolve); });
    }
    await work;
  }

  return ndjsonStream(stream());
}
