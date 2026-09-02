/**
 * S-14 해피콜 응답 연습 (SR-214 · R-06).
 *
 * 모델·DB·외부 조회가 전혀 없다 — 시나리오는 배포 번들의 코드 상수다.
 * 모델 장애·DB 장애에도 이 화면은 정상 동작한다 (예방 축 원칙).
 */

import type { Metadata } from "next";
import { HappycallChooser } from "./happycall-flow";
import { HAPPYCALL_SCENARIOS } from "@/lib/happycall";

export const metadata: Metadata = {
  title: "해피콜 연습 — 프리케이스",
};

export default function HappycallPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-[1.6rem] font-bold leading-snug tracking-tight text-fg">
        확인 전화(해피콜), 미리 연습해 보세요
      </h1>
      <p className="mt-2 leading-relaxed text-fg-muted">소요 2분 · 저장되지 않습니다</p>
      <div className="mt-8">
        <HappycallChooser scenarios={HAPPYCALL_SCENARIOS} />
      </div>
    </main>
  );
}
