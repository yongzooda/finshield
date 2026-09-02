/**
 * POST /api/consult — ① 상담 계층. 진술 접수와 되묻기 한 턴.
 *
 * 본문 3형태:
 *   `{ consent: true }`                          세션 생성 + 민감정보 동의 (F-602)
 *   `{ sessionId, statement }`                   진술 접수 → 첫 되묻기
 *   `{ sessionId, slot, value }`                 되묻기 답변 → 다음 질문 또는 완료
 *
 * **진술은 마스킹을 통과한 것만 모델로 간다** (F-601). 잔존 의심이 있으면
 * 전송하지 않고 무엇을 지워야 하는지 돌려준다 (EX-106).
 *
 * 저장하지 않는다 — 진술·슬롯·사실관계는 전부 메모리 세션 안에서만 산다
 * (DR-401~403). 서버 로그에도 본문을 남기지 않는다 (N-403).
 */

import { consult } from "@/lib/agents/consult";
import { gateForModel } from "@/lib/agents/pii";
import { createSession, EXPIRED_MESSAGE, openSession, sealSession, startNewCycle, tryAsk, type Session } from "@/lib/agents/session";
import { applySlots } from "@/lib/agents/slots";
import { jsonNoStore, readJson, str } from "@/lib/ops/http";
import { env } from "@/lib/env";
import { budgetState, QUOTA_EXCEEDED_MESSAGE } from "@/lib/ops/budget";
import { alertOperator } from "@/lib/ops/alert";
import { gate } from "@/lib/ops/rate-limit";
import { answerFormFor } from "@/lib/labels";
import type { Slots } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 상담 한 턴은 P95 20초(N-102)지만 모델 지연 꼬리를 넉넉히 덮는다 */
export const maxDuration = 120;

/** 되묻기 상한 소진 — 실패가 아니라 판단으로 넘어갈 때가 됐다는 뜻이다 (EX-103) */
const ASK_LIMIT_MESSAGE =
  "여쭤볼 수 있는 만큼 다 여쭤봤습니다. 지금까지 말씀해 주신 내용으로 살펴보겠습니다.";

function askPayload(r: Extract<Awaited<ReturnType<typeof consult>>, { kind: "ASK" }>) {
  return {
    kind: "ASK" as const,
    slot: r.slot,
    question: r.question,
    /** 이 슬롯을 어떤 형식으로 답하게 할지 — 열거형은 자유 입력을 두지 않는다 */
    form: answerFormFor(r.slot),
  };
}

export async function POST(req: Request): Promise<Response> {
  // N-203 분당 상한 — 되묻기 한 턴마다 오므로 모든 요청에 건다
  const throttled = gate(req, "REQUEST");
  if (throttled) return throttled;

  const body = await readJson(req, 16 * 1024);
  if (!body.ok) return body.response;
  const v = body.value as Record<string, unknown>;

  // ── 세션 생성 — 민감정보 별도 동의를 받은 뒤에만 (F-602)
  if (v.consent === true && !v.session) {
    // N-203 세션 생성 시간당 상한. 되묻기는 세지 않는다 —
    // 재상담(F-308)을 포함한 정상 시나리오를 막지 않아야 한다
    const tooMany = gate(req, "SESSION");
    if (tooMany) return tooMany;

    // EX-404 — 예산이 소진되면 **신규 상담만** 막는다. 진행 중인 상담과
    // 예방 축·검증 결과·데모는 그대로 열려 있다 (서비스 전체가 죽은 인상 방지)
    const budget = await budgetState();
    if (!budget.allowed) {
      void alertOperator("QUOTA_EXCEEDED", {
        spent: budget.spentUsd.toFixed(2),
        budget: budget.budgetUsd.toFixed(2),
      });
      return jsonNoStore({ kind: "QUOTA", message: QUOTA_EXCEEDED_MESSAGE }, 503);
    }
    if (budget.warning) {
      void alertOperator("QUOTA_WARNING", {
        percent: Math.round(budget.ratio * 100),
        spent: budget.spentUsd.toFixed(2),
        budget: budget.budgetUsd.toFixed(2),
      });
    }

    const s = createSession();
    s.sensitiveConsent = true;
    s.trace.info("CONSULT", "민감정보 처리에 동의했습니다");
    return jsonNoStore({ kind: "SESSION", session: sealSession(s, null) }, 201);
  }

  const token = str(v, "session");
  if (!token) return jsonNoStore({ ok: false, error: "SESSION_REQUIRED" }, 400);

  const found = openSession(token);
  if (!found.ok) {
    return jsonNoStore({ kind: "EXPIRED", error: found.reason, message: found.message }, 410);
  }
  const session = found.session;

  if (!session.sensitiveConsent) {
    return jsonNoStore({ ok: false, error: "CONSENT_REQUIRED" }, 403);
  }

  // ── 진술 접수
  const statement = str(v, "statement");
  if (statement !== null) {
    const trimmed = statement.trim();
    if (!trimmed) {
      return jsonNoStore({ kind: "INVALID", message: "어떤 일이 있었는지 알려주세요." }, 400);
    }
    if (trimmed.length > env.MAX_STATEMENT_CHARS) {
      return jsonNoStore(
        {
          kind: "INVALID",
          message: `한 번에 ${env.MAX_STATEMENT_CHARS}자까지 받습니다. 나눠서 말씀해 주세요.`,
        },
        400,
      );
    }

    // F-601 — 마스킹을 통과하지 못하면 모델로 보내지 않는다
    const gate = gateForModel(trimmed);
    if (!gate.ok) {
      session.trace.warn("CONSULT", "개인정보 잔존 의심으로 전송을 막았습니다");
      return jsonNoStore({ kind: "PII_RESIDUAL", message: gate.ask }, 400);
    }

    // 유보 이어가기 (F-308 확장 · R-07 ①) — 직전 판단이 유보였던 세션에 진술이
    // 다시 오면 같은 세션에서 사이클을 새로 연다. 슬롯·정제 사실관계·되묻기 누적
    // 카운터(총 상한 10 불변)가 그대로 이어진다. 화면 명세 4.2의 「새 세션이
    // 아니라 기존 세션의 상담 맥락을 유지한 채 S-03으로 돌아간다」의 구현이다.
    if (session.reentryNeeded?.length && session.facts) {
      startNewCycle(session);
      session.trace.info("CONSULT", "유보 이후 자료를 보태어 상담을 이어갑니다");
    }

    session.trace.info("CONSULT", `진술을 받았습니다 (마스킹 ${gate.masked.total}건)`);
    return turn(session, gate.masked.text, gate.masked.total);
  }

  // ── 되묻기 답변
  const slot = str(v, "slot");
  if (slot !== null) {
    const masked = found.maskedStatement;
    if (masked === null) {
      // 진술 없이 답변만 온 경우 — 안내는 세션 만료와 같게 한다.
      // 이용자에게 내부 사정을 구분해 보일 이유가 없다 (session.ts와 같은 태도).
      // 세션은 살아 있는데 진술만 없는 경우 — 이용자에게는 만료와 같은 말로 설명한다
      return jsonNoStore({ kind: "EXPIRED", error: "STATEMENT_GONE", message: EXPIRED_MESSAGE }, 410);
    }

    // 답변은 반드시 applySlots를 거친다 — 열거 밖 값 차단(F-605)과 ELDER 파생이
    // 거기 있다. 클라이언트가 보낸 값을 그대로 병합하는 경로를 만들지 않는다.
    const applied = applySlots(session.slots, { [slot]: v.value } as Partial<Slots>);
    if (!applied.ok) {
      session.trace.warn("CONSULT", "답변 형식이 맞지 않아 다시 여쭤봅니다");
      return jsonNoStore(
        { kind: "INVALID", message: "고르신 값을 알아듣지 못했습니다. 다시 골라 주세요." },
        400,
      );
    }
    session.slots = applied.slots;
    return turn(session, masked, 0);
  }

  return jsonNoStore({ ok: false, error: "NOTHING_TO_DO" }, 400);
}

/** 한 턴 — 모델을 부르고 다음 질문·완료·거절 중 하나를 돌려준다 */
async function turn(session: Session, masked: string, maskedCount: number): Promise<Response> {
  /** 매 응답에 갱신된 봉인을 실어 보낸다 — 서버에 남는 것이 없으므로 이것이 세션의 전부다 */
  const sealed = () => sealSession(session, masked);

  // 이어가기 맥락 — 봉인 안의 값만 쓴다. 클라이언트가 보낸 목록을 믿지 않는다.
  // 이전 사실관계가 없으면 이어갈 것도 없다 (판단을 거치지 않은 세션).
  const reentry =
    session.reentryNeeded?.length && session.facts
      ? { needed: session.reentryNeeded, priorFacts: session.facts }
      : null;

  let r;
  try {
    r = await consult({ maskedStatement: masked, slots: session.slots, askedCount: session.askedTotal, reentry },
      (errs) => session.trace.warn("CONSULT", "슬롯 검증 실패", { n: errs.length }));
  } catch {
    // 모델 장애 (EX-401). 예방 축·검증 결과는 계속 열려 있음을 알린다
    session.trace.warn("CONSULT", "상담 계층 호출 실패");
    return jsonNoStore(
      {
        kind: "MODEL_DOWN",
        message:
          "지금은 상담을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요. " +
          "그동안 「가입 전 확인」과 「검증 결과」는 그대로 이용하실 수 있습니다.",
      },
      503,
    );
  }

  if (r.kind === "OUT_OF_SCOPE") {
    session.trace.info("CONSULT", "범위 밖 요청으로 판단했습니다");
    return jsonNoStore({ kind: "OUT_OF_SCOPE", message: r.message, maskedCount, session: sealed() });
  }

  if (r.kind === "READY") {
    session.slots = r.slots;
    session.facts = r.facts;
    session.trace.info("CONSULT", "판단에 필요한 내용이 모였습니다");
    return jsonNoStore({ kind: "READY", maskedCount, session: sealed() });
  }

  // ASK — 상한을 넘으면 더 묻지 않고 지금까지 모인 것으로 넘어간다 (EX-103)
  session.slots = r.slots;
  const gate = tryAsk(session);
  if (!gate.ok) {
    session.trace.warn("CONSULT", `되묻기 상한 도달 (${gate.scope})`);
    // 사실관계가 없으면 판단이 유보로 끝난다 — 그것이 안전한 종착이다 (EP-2)
    return jsonNoStore({ kind: "READY", limited: true, message: ASK_LIMIT_MESSAGE, maskedCount, session: sealed() });
  }

  return jsonNoStore({ ...askPayload(r), maskedCount, session: sealed() });
}
