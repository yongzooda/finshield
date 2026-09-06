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
        <h1 className="fs-h1 mt-2">내 검증 기록</h1>
        <p className="fs-lead mt-3 max-w-2xl">
          이전 결과와 근거를 다시 보고, 재검증과 가입 후 점검을 이어가세요.
        </p>
      </header>
      <CaseList />
    </FsShell>
  );
}
