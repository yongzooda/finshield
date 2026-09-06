import type { Metadata } from "next";
import { VerifyFlow } from "./verify-flow";

export const metadata: Metadata = { title: "거래 전 검증 | FinShield" };
export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header>
        <h1 className="text-[1.7rem] font-bold leading-tight tracking-tight text-navy">
          거래 전에 확인합니다
        </h1>
        <p className="mt-3 text-[1.02rem] leading-relaxed text-slate-700">
          권유받은 내용을 붙여 넣으면 무엇을 확인해야 하는지 목록으로 만들어 드립니다.
          고르신 항목만 공식 자료에 대고 확인하고, 확인한 근거를 그대로 보여 드립니다.
        </p>
        {/* 규칙 4·SEC-PRI-001 — 입력 전에 알린다. */}
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-[0.95rem] leading-relaxed text-amber-900">
          실제 주민등록번호와 계좌번호와 연락처는 넣지 마세요. 넣으셔도 저장 전에 가려지지만,
          애초에 받지 않는 것이 안전합니다. 원본 문장은 저장하지 않습니다.
        </p>
      </header>
      <VerifyFlow />
    </div>
  );
}
