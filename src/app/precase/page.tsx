import type { Metadata } from "next";
import Link from "next/link";
import { FsCard, FsShell } from "../fs-shell";
import { FsIcon } from "../fs-icon";
import { CaseList } from "../cases/case-list";

export const metadata: Metadata = { title: "가입 후 보호 | FinShield" };
export const dynamic = "force-dynamic";

/** PC-001: 기존 검증 기록에서 가입 사실과 보호 점검으로 이어진다. */
export default function AftercarePage() {
  return (
    <FsShell>
      <header>
        <p className="fs-eyebrow">가입 후 보호</p>
        <h1 className="fs-h1 mt-2">계약이 설명과 같았나요?</h1>
        <p className="fs-lead mt-3">확인했던 거래를 선택해 가입 사실을 등록하고, 설명과 계약 조건을 점검하세요.</p>
      </header>
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        {[["01", "가입 사실 등록"], ["02", "설명·계약 점검"], ["03", "문의·정정 준비"]].map(([step, label]) => (
          <div key={step} className="flex items-center gap-3 rounded-xl bg-white px-4 py-4"><span className="fs-meta">{step}</span><span className="font-semibold">{label}</span></div>
        ))}
      </div>
      <CaseList intent="aftercare" />
      <FsCard className="mt-6">
        <div className="flex gap-3"><FsIcon name="shield" /><div><h2 className="fs-h2">이미 송금했거나 피해가 의심되나요?</h2><p className="fs-body mt-2">기록의 ‘가입·피해 사실 등록’에서 상황을 남기고 후속 안내를 확인할 수 있습니다.</p><Link href="/cases" className="fs-text-link mt-2">검증 기록에서 이어가기 <FsIcon name="arrow" /></Link></div></div>
      </FsCard>
    </FsShell>
  );
}
