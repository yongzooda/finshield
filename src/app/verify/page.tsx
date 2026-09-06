import type { Metadata } from "next";
import { FsShell } from "../fs-shell";
import { VerifyFlow } from "./verify-flow";

export const metadata: Metadata = { title: "거래 전 검증 | FinShield" };
export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <FsShell>
      <header>
        <p className="fs-eyebrow">거래 전 검증</p>
        <h1 className="fs-h1 mt-2">받은 대출 권유를 확인해 보세요</h1>
        <p className="fs-lead mt-3 max-w-2xl">
          내용을 붙여 넣고 확인할 항목을 선택하면, 공식 자료와 대조한 결과를 볼 수 있습니다.
        </p>
      </header>
      <VerifyFlow />
    </FsShell>
  );
}
