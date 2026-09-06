import type { Metadata } from "next";
import { FsShell } from "../fs-shell";
import { CaseList } from "./case-list";

export const metadata: Metadata = { title: "내 검증 기록 | FinShield" };
export const dynamic = "force-dynamic";

export default function CasesPage() {
  return (
    <FsShell>
      <header>
        <p className="fs-eyebrow">내 검증 기록</p>
        <h1 className="fs-h1 mt-2">지금까지 확인한 건들</h1>
        <p className="fs-lead mt-3 max-w-2xl">
          본인이 만든 건만 보입니다. 다른 사람의 기록은 데이터베이스 정책이 막습니다.
        </p>
      </header>
      <CaseList />
    </FsShell>
  );
}
