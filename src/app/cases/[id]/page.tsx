import type { Metadata } from "next";
import { FsShell } from "../../fs-shell";
import { CaseDetail } from "./case-detail";

export const metadata: Metadata = { title: "검증 기록 | FinShield" };
export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FsShell>
      <CaseDetail caseId={id} />
    </FsShell>
  );
}
