/**
 * 판단 데모 (judgment) — 실제 조정례로 4계층 파이프라인을 돌린 결과.
 *
 * S-04를 **같은 컴포넌트로** 렌더한다. 근거 3분류·자료 체크리스트·실행 로그·
 * 근거 상세(S-05)까지 실제 화면과 동일하게 동작한다.
 *
 * 데이터는 배포 번들의 정적 자산이라 **DB·모델·법제처 조회가 하나도 없다**
 * (DR-107 — 외부 API 상태와 무관하게 열람 보장).
 */

import type { Metadata } from "next";
import { JudgmentResult } from "../../judgment/judgment-result";
import type { JudgmentDone } from "../../judgment/types";
import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";
import { DemoLabel } from "../demo-label";
import demo from "@/lib/demo/concluded";

export const metadata: Metadata = { title: "데모 — 판단 결과 | 프리케이스" };

export default function DemoPage() {
  return (
    <>
      <DemoLabel what="은행 창구에서 ELS에 가입했다가 손실을 본 실제 분쟁조정 사건으로 판단을 돌린 결과입니다." />
      <JudgmentResult
        done={demo as unknown as JudgmentDone}
        /* 절차 안내 조문은 생성 시점에 실조회해 번들에 굳혔다 — 데모는 외부 조회를 하지 않는다 (DR-107) */
        procedureStatutes={(demo as unknown as { procedureStatutes?: LookupStatuteResult[] }).procedureStatutes ?? []}
      />
    </>
  );
}
