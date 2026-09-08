import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const request = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: request }; } }));
vi.mock("@/lib/ops/budget", () => ({ recordUsage: vi.fn() }));
import { callStructured } from "@/lib/agents/model";
const receipt = { id: "synthetic-provider-response", usage: { input_tokens: 20, output_tokens: 12 }, stop_reason: "end_turn" };
beforeEach(() => request.mockReset());

it.each([
  ["end_turn", '{"rationale_masked":""}', "SCHEMA_ERROR", "MODEL_SCHEMA_RATIONALE_MASKED_TOO_SMALL"],
  ["end_turn", '형식 오류 원문을 출력하지 않는다', "SCHEMA_ERROR", "MODEL_JSON_INVALID"],
  ["refusal", '거절 원문', "REFUSAL", "MODEL_REFUSAL"],
  ["max_tokens", '{"rationale_masked":', "SCHEMA_ERROR", "MODEL_OUTPUT_TRUNCATED"],
])("%s 응답 형식 실패도 받은 사용량을 정산한 뒤 안전한 오류로 종결한다", async (stop_reason, text, statusCategory, code) => {
  request.mockResolvedValue({ ...receipt, stop_reason, content: [{ type: "text", text }] });
  const onUsage = vi.fn();
  await expect(callStructured({ system: "합성 검증", user: "합성 문장", schema: z.object({ rationale_masked: z.string().min(1) }), skipLegacyMeter: true, onUsage }))
    .rejects.toMatchObject({ name: "ModelFormatError", code });
  expect(onUsage).toHaveBeenCalledOnce();
  expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: receipt.usage, statusCategory }));
});

it("정상 응답은 실제 사용량과 함께 검증된 구조를 반환한다", async () => {
  request.mockResolvedValue({ ...receipt, content: [{ type: "text", text: '{"rationale_masked":"근거 비교"}' }] });
  const onUsage = vi.fn();
  expect(await callStructured({ system: "합성 검증", user: "합성 문장", schema: z.object({ rationale_masked: z.string().min(1) }), skipLegacyMeter: true, onUsage }))
    .toEqual({ rationale_masked: "근거 비교" });
  expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ statusCategory: "OK" }));
});
