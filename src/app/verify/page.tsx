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
        <h1 className="fs-h1 mt-2">권유받은 내용을 확인합니다</h1>
        <p className="fs-lead mt-3 max-w-2xl">
          붙여 넣으신 내용에서 확인할 항목을 뽑아 드립니다. 고르신 항목만 공식 자료에 대고
          확인하고, 무엇을 근거로 판단했는지 항목마다 열어 보실 수 있습니다.
        </p>
      </header>
      <VerifyFlow />
    </FsShell>
  );
}
