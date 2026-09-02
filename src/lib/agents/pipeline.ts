/**
 * 판단 파이프라인의 스트리밍 실행 — ② 조사 → ③ 판단 → ④ 안내.
 *
 * S-04가 이 생성기를 그대로 소비한다. 스트리밍이 필요한 이유는 **함수 실행 시간
 * 제한 때문이 아니다.** 실측(2026.08.16): Vercel Hobby는 Fluid compute 기본값으로
 * `maxDuration` 최대 **300초**라서 판단 P95 120초(N-103)는 한계에 닿지 않는다.
 * 스트리밍이 필요한 이유는 둘이다:
 *
 *   1. **연결이 끊긴다.** Vercel 문서가 명시한다 — HTTP/1.1에는 HTTP/2의 PING에
 *      해당하는 프레임이 없어 **중간 네트워크 계층이 유휴 연결을 닫을 수 있다.**
 *      그래서 작업 중에는 진행 데이터나 하트비트를 흘려보내야 한다. 카카오톡
 *      인앱 브라우저(N-701)를 거치는 경로에서 특히 중요하다
 *   2. **N-102 — 스트리밍 시작 5초.** 조사 단계는 도구를 8~9회 부르므로 첫 응답을
 *      다 끝난 뒤에 주면 20초 넘게 빈 화면이 된다 (화면 4.3 "무단계 스피너만
 *      두지 않는다")
 *
 * 저장하지 않는다 — 이벤트는 응답으로 흘러갈 뿐 서버·DB·로그에 남지 않는다
 * (DR-4xx). 카운터만 예외로 **횟수**를 센다 (DR-302).
 */

import "server-only";
import { investigate } from "./investigate";
import { judge } from "./judge";
import { guide, guideWithheld, type GuideResult } from "./guide";
import { basisDateFrom, finalizeSlots } from "./slots";
import type { Session } from "./session";
import type { Evidence, JudgmentOutcome } from "./types";
import type { Trace, TraceEntry } from "./trace";
import type { Slots } from "../types";
import { bumpCounter } from "../ops/counters";

/**
 * 화면이 받는 이벤트. **판단 본문은 `done`에서 한 번에** 준다 —
 * 결론을 토막내 흘리면 이용자가 중간 조각을 결론으로 읽는다(S-03 금지사항의
 * "승산 낙관 표현"과 같은 위험).
 */
export type JudgmentEvent =
  /** 현재 단계를 문장으로. 화면 4.3 로딩 규칙 — 무단계 스피너를 두지 않는다 */
  | { type: "stage"; stage: "INVESTIGATE" | "JUDGE" | "GUIDE"; message: string }
  /** 유휴 연결 차단용. 경과 시간만 담는다 */
  | { type: "heartbeat"; elapsedMs: number }
  /**
   * 실행 로그 한 줄을 **쌓이는 즉시** 흘린다 (F-402를 진행 중에 보이게 한 것).
   * `done`의 `trace`에 실려 나가는 것과 같은 항목이며 새 정보가 아니다.
   */
  | {
      type: "step";
      seq: number;
      level: TraceEntry["level"];
      message: string;
      detail?: TraceEntry["detail"];
    }
  | {
      type: "done";
      outcome: JudgmentOutcome;
      guide: GuideResult;
      /**
       * 수집 근거 **전체**. 화면이 근거를 렌더하려면 도구 반환 객체 자체가 있어야
       * 한다 — 문자열로 요약해 보내면 화면이 그 문자열을 믿게 되고, 그 순간
       * F-603의 「도구가 반환하지 않은 것은 렌더될 수 없다」가 깨진다.
       */
      evidence: Evidence;
      /** 무엇을 근거로 판단했는지 되짚어 보이기 위해 (기획서 9.2 미확인 슬롯 명시) */
      slots: Slots;
      /** 실행 로그 전문 (F-402 · S-08). 세션 안에서만 읽히고 저장되지 않는다 */
      trace: readonly TraceEntry[];
      elapsedMs: number;
      /**
       * 판단을 마친 뒤 다시 봉인한 세션 (F-308 확장 · R-07 ①). 유보면 «필요
       * 자료» 목록이 들어 있어 이걸 들고 상담에 재진입하면 이어진다. 판단 중
       * 소모한 도구 카운터도 담기므로 세션당 상한(F-607)이 재진입 후에도
       * 정확하다 — 판단 전 토큰을 다시 쓰면 조사 사용분이 누락된다.
       */
      session?: string;
    }
  /** 실패도 안전한 방향으로 (EP-3). 사용자 책임처럼 읽히는 문구를 쓰지 않는다 */
  | { type: "error"; code: "SLOTS_INCOMPLETE" | "PIPELINE_FAILED"; message: string };

/** 하트비트 간격. 중간 계층의 유휴 타임아웃보다 넉넉히 짧게 잡는다 */
const HEARTBEAT_MS = 10_000;

/** 실행 로그를 훑어보는 간격. 도구 한 건이 끝나면 곧 화면에 뜬다 */
const POLL_MS = 700;

/**
 * 오래 걸리는 작업을 기다리면서 **그 사이 쌓인 실행 로그와 하트비트를 흘린다.**
 *
 * ## 왜 실행 로그를 흘리나
 *
 * 조사 구간은 도구를 8\~10회 부르며 50초 넘게 돈다. 그런데 예전에는 그 구간에
 * 단계 문장 하나만 띄우고 나머지는 침묵했다 — **가장 일을 많이 하는 구간이
 * 가장 조용했다.** 이용자에게는 멈춘 것처럼 보이고, 실제로 무엇을 조회하는지는
 * 다 끝난 뒤 실행 로그를 펼쳐야 알 수 있었다.
 *
 * 흘려보내는 것은 **이미 `done`에 실려 나가는 바로 그 항목**이다(F-402 실행 로그).
 * 새로 노출되는 정보가 없고, 도착 시점만 앞당긴다. 진술·슬롯 값은 애초에
 * `Trace`에 담기지 않는다 (N-403).
 *
 * `Promise.race`로 타이머와 겨루되, **작업 프로미스의 거부를 먼저 붙잡아 둔다** —
 * race에서 진 쪽의 거부가 미처리 거부로 새면 런타임이 프로세스를 죽인다.
 */
async function* beat<T>(
  work: Promise<T>,
  startedAt: number,
  trace: Trace,
  /** 이미 흘려보낸 로그 개수. 계층을 넘어가도 이어져야 해서 밖에서 들고 있다 */
  sent: { count: number },
): AsyncGenerator<JudgmentEvent, T> {
  let settled = false;
  const guarded = work.then(
    (v) => { settled = true; return { ok: true as const, v }; },
    (e) => { settled = true; return { ok: false as const, e }; },
  );

  let sinceBeat = 0;
  while (!settled) {
    const tick = new Promise<"tick">((r) => setTimeout(() => r("tick"), POLL_MS));
    const who = await Promise.race([guarded.then(() => "work" as const), tick]);
    if (who !== "tick" || settled) break;

    sinceBeat += POLL_MS;
    const fresh = trace.read().slice(sent.count);
    for (const e of fresh) {
      yield { type: "step", seq: e.seq, level: e.level, message: e.message, detail: e.detail };
    }
    sent.count += fresh.length;

    // 새 로그가 흘렀으면 연결이 살아 있다는 신호가 이미 간 것이다
    if (fresh.length > 0) sinceBeat = 0;
    else if (sinceBeat >= HEARTBEAT_MS) {
      sinceBeat = 0;
      yield { type: "heartbeat", elapsedMs: Date.now() - startedAt };
    }
  }

  const r = await guarded;
  if (!r.ok) throw r.e;
  return r.v;
}

/**
 * 세션의 확정 슬롯·정제 사실관계로 ②③④를 돌린다.
 *
 * 세션 객체를 받는 이유는 예산(F-607)과 실행 로그(F-402)가 세션에 매달려 있기
 * 때문이다. **원문은 세션에도 없다** — ① 상담이 정제 사실관계만 남긴다.
 */
export async function* runJudgment(
  session: Session,
  /**
   * 판단을 마친 세션을 봉인하는 콜백. 라우트가 넘긴다 — 봉인에는 마스킹 진술이
   * 필요한데 그건 라우트만 갖고 있다 (sealSession 주석: Session 객체에 올리지
   * 않는 것이 SR-402 유지 방식이다).
   */
  sealed?: () => string,
): AsyncGenerator<JudgmentEvent> {
  const startedAt = Date.now();

  const fin = finalizeSlots(session.slots);
  if (!fin.ok || !session.facts) {
    yield {
      type: "error",
      code: "SLOTS_INCOMPLETE",
      message: "판단에 필요한 내용이 아직 다 모이지 않았습니다. 상담을 이어서 진행해 주세요.",
    };
    return;
  }
  const slots = fin.slots;
  const facts = session.facts;
  // 상담 구간에서 쌓인 로그는 흘리지 않는다 — 지금 화면에서 벌어지는 일만 보인다.
  // 전체 로그는 `done`의 `trace`에 그대로 실려 나간다
  const sent = { count: session.trace.read().length };

  try {
    // ② 조사 — 가장 긴 구간이다. 도구를 여러 번 부르는 동안 하트비트가 흐른다
    yield { type: "stage", stage: "INVESTIGATE", message: "관련 법령과 비슷한 사례를 찾고 있습니다." };
    const inv = yield* beat(
      investigate(
        { slots, facts, basisDate: basisDateFrom(slots) },
        { budget: session.budget, trace: session.trace },
      ),
      startedAt, session.trace, sent,
    );
    session.evidence = inv.evidence;

    // ③ 판단
    yield { type: "stage", stage: "JUDGE", message: "찾은 근거로 성립 가능성을 따져보고 있습니다." };
    const outcome = yield* beat(
      judge({ slots, facts, evidence: inv.evidence }, session.trace),
      startedAt, session.trace, sent,
    );
    session.outcome = outcome;

    // ④ 안내 — 유보는 모델을 부르지 않는다(코드가 만든다). 그래서 빠르다
    yield { type: "stage", stage: "GUIDE", message: "읽기 쉬운 말로 정리하고 있습니다." };
    const g =
      outcome.kind === "CONCLUDED"
        ? yield* beat(
            guide({ slots, evidence: inv.evidence, judgment: outcome.judgment }, session.trace),
            startedAt, session.trace, sent,
          )
        : guideWithheld(outcome);

    // DR-302 — 횟수만 센다. 실패해도 판단 결과를 막지 않는다
    await bumpCounter(outcome.kind === "CONCLUDED" ? "JUDGMENT_DONE" : "WITHHELD");

    // 유보 이어가기 (F-308 확장) — 유보의 «필요 자료» 목록만 세션에 싣는다.
    // 결론·확신도·이유는 싣지 않는다 (seal.ts 주석). 결론이 났으면 지운다 —
    // 낡은 목록이 다음 상담에 끼어들면 안 된다.
    session.reentryNeeded = outcome.kind === "WITHHELD" && outcome.needed.length
      ? [...outcome.needed]
      : null;

    yield {
      type: "done",
      outcome,
      guide: g,
      evidence: inv.evidence,
      slots,
      trace: session.trace.read(),
      elapsedMs: Date.now() - startedAt,
      // 봉인은 reentryNeeded를 채운 뒤에 한다 — 순서가 바뀌면 빈 목록이 실린다
      session: sealed?.(),
    };
  } catch {
    // 예외 내용을 응답에 싣지 않는다 — 진술·슬롯이 메시지에 섞여 나올 수 있다
    session.trace.warn("SYSTEM", "판단 파이프라인 실패");
    yield {
      type: "error",
      code: "PIPELINE_FAILED",
      message: "판단을 끝내지 못했습니다. 저희 쪽 문제이며, 잠시 후 다시 시도해 주세요.",
    };
  }
}
