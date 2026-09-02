/** `/api/judge`가 흘리는 `done` 이벤트의 클라이언트 쪽 형태 */

import type { Evidence, JudgmentOutcome } from "@/lib/agents/types";
import type { GuideResult } from "@/lib/agents/guide";
import type { TraceEntry } from "@/lib/agents/trace";
import type { Slots } from "@/lib/types";

export type JudgmentDone = {
  type: "done";
  outcome: JudgmentOutcome;
  guide: GuideResult;
  evidence: Evidence;
  slots: Slots;
  trace: readonly TraceEntry[];
  elapsedMs: number;
  /** 판단을 마친 뒤 재봉인된 세션 — 유보 이어가기(F-308 확장)가 이걸 들고 재진입한다 */
  session?: string;
};
