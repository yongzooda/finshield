/**
 * Claude 호출 공통층 (E-06).
 *
 * 계층 구현이 SDK를 직접 부르지 않고 여기를 거치게 한다. 이유 셋:
 *
 *  1. **모델·설정을 한 곳에서만 읽는다.** 운영 모델은 `ANTHROPIC_MODEL`이며
 *     교체 시 확신도 임계 재보정이 필요하다 (A-2·A-6). 호출부마다 모델명을
 *     박아두면 교체를 놓친다.
 *  2. **구조화 출력을 강제한다.** ①과 ③은 자유 텍스트가 아니라 스키마를 돌려줘야
 *     한다. `output_config.format`으로 형식을 보장하고, 형식 위반은 EX-303으로
 *     처리한다 — 파싱 실패를 조용히 넘기지 않는다.
 *  3. **판단 P95 120초를 스트리밍으로 받는다** (N-103). Vercel 함수 제한과
 *     SDK 타임아웃 양쪽에 걸리므로 긴 호출은 스트리밍이 기본이다.
 *
 * `temperature`·`top_p`는 쓰지 않는다 — 운영 모델에서 제거된 파라미터다.
 * 스타일·분량은 프롬프트로 잡는다.
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "../env";
import { recordUsage } from "../ops/budget";

declare global {
  var __precase_anthropic: Anthropic | undefined;
}

export const anthropic =
  globalThis.__precase_anthropic ??
  new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    // 판단 파이프라인이 길다. SDK 기본 재시도(2회)는 그대로 두되
    // 타임아웃은 N-103(P95 120초)에 맞춘다.
    timeout: 150_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__precase_anthropic = anthropic;
}

/** 계층별 사고 깊이. 판단이 가장 깊고, 안내는 변환이라 얕다 */
export type Effort = "low" | "medium" | "high";

export class ModelFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelFormatError";
  }
}

export type StructuredCallOptions<T extends z.ZodType> = {
  system: string;
  /** 사용자 역할로 들어갈 내용. 계층에 따라 원문일 수도, 슬롯 요약일 수도 있다 */
  user: string;
  schema: T;
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
};

/**
 * 구조화 출력 호출. 스키마에 맞지 않으면 `ModelFormatError`를 던진다.
 *
 * 호출부는 이걸 잡아 **유보 경로(EX-303)**로 보낸다 — 형식이 깨진 판단을
 * 억지로 해석해 결론을 만들면 그게 환각이다.
 */
/**
 * 토큰 사용량을 예산 계량에 흘린다 (N-204).
 *
 * **기다리지 않는다.** 계량은 관측 수단이지 기능이 아니므로, DB가 느리다고
 * 이용자의 응답이 늦어지면 안 된다. 실패도 `recordUsage`가 삼킨다.
 *
 * 캐시 읽기·쓰기 토큰도 입력에 더한다 — 과금 대상이다.
 */
function meter(usage: Anthropic.Usage | null | undefined): void {
  if (!usage) return;
  // 측정 러너(PRECASE_LIVE=1)의 사용량은 서비스 일 예산에 계상하지 않는다 (N-204).
  // 게이트는 이용자 트래픽의 지출을 끊는 장치인데, 러너는 게이트를 거치지 않고
  // 지출하면서 계량만 공유 DB에 남겨 **다음날까지 프로덕션 신규 상담을 잠갔다**
  // (2026.08.30 실측 — spentUsd 9.14/2.0, 신규 상담 503). 측정 지출은 크레딧
  // 잔액으로 따로 관리한다(SPRINT 상시 규칙). 이 변수는 러너만 설정한다.
  if (process.env.PRECASE_LIVE === "1") return;
  const input =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  void recordUsage(env.ANTHROPIC_MODEL, input, usage.output_tokens ?? 0);
}

export async function callStructured<T extends z.ZodType>(
  opts: StructuredCallOptions<T>,
): Promise<z.infer<T>> {
  const res = await anthropic.messages.parse({
    model: env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 8_000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: {
      format: zodOutputFormat(opts.schema),
      ...(opts.effort ? { effort: opts.effort } : {}),
    },
  }, {
    signal: opts.signal, timeout: opts.timeoutMs, maxRetries: opts.maxRetries,
  });

  // ⚠️ **계량이 결과 판정보다 먼저다** (N-204). 거절이든 토큰 상한이든 토큰은
  // 이미 쓰였다. 성공한 호출만 세면 실패가 잦을수록 쿼터가 실제보다 낮게 보인다.
  meter(res.usage);

  // 안전 분류기가 거절하면 content가 비거나 부분적이다. 먼저 본다.
  if (res.stop_reason === "refusal") {
    throw new ModelFormatError("모델이 응답을 거절했다 (안전 분류기)");
  }
  if (res.stop_reason === "max_tokens") {
    throw new ModelFormatError("응답이 토큰 상한에서 잘렸다 — max_tokens 상향 필요");
  }
  if (res.parsed_output == null) {
    throw new ModelFormatError("구조화 출력 파싱 실패");
  }
  return res.parsed_output as z.infer<T>;
}

export type TextCallOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  effort?: Effort;
  /** 토큰이 나올 때마다 호출된다. 화면 스트리밍용 */
  onDelta?: (text: string) => void;
};

/**
 * 자유 텍스트 호출 — 스트리밍.
 *
 * ④ 안내처럼 형식이 아니라 문장이 결과인 계층에 쓴다. 스트리밍인 이유는
 * 길이 때문이 아니라 **체감 지연** 때문이다 — 상담 턴 P95 20초 중
 * 스트리밍 시작은 5초 안에 와야 한다 (N-102).
 */
export async function callText(opts: TextCallOptions): Promise<string> {
  const stream = anthropic.messages.stream({
    model: env.ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 4_000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
  });

  if (opts.onDelta) stream.on("text", opts.onDelta);

  const msg = await stream.finalMessage();
  meter(msg.usage);
  if (msg.stop_reason === "refusal") {
    throw new ModelFormatError("모델이 응답을 거절했다 (안전 분류기)");
  }
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
