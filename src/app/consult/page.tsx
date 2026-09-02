/**
 * S-03 상담 대화 (SR-203).
 *
 * 자연어 진술에서 필수 슬롯 5종을 확정한다. 되묻기 횟수와 순서는 ① 상담
 * 에이전트가 자율 결정하므로(F-302) 진행 상태를 URL로 나를 수 없다 —
 * S-02와 달리 클라이언트 컴포넌트다.
 *
 * 금지 — 파일 업로드 UI(SR-X07) · 승산 낙관 표현(판단은 S-04에서만).
 */

import type { Metadata } from "next";
import { ConsultFlow } from "./consult-flow";

export const metadata: Metadata = {
  title: "상담 — 프리케이스",
  description:
    "있었던 일을 말씀해 주시면 몇 가지를 여쭤본 뒤, 공개된 분쟁조정 선례와 법령으로 성립 가능성을 살펴봅니다.",
};

export default function ConsultPage() {
  return <ConsultFlow />;
}
