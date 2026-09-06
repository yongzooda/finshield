import type { Metadata } from "next";
import { FsShell } from "../../../fs-shell";
import { RevalidateFlow } from "./revalidate-flow";

export const metadata: Metadata = { title: "다시 확인하기 | FinShield" };
export const dynamic = "force-dynamic";

export default async function RevalidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FsShell>
      <RevalidateFlow caseId={id} />
    </FsShell>
  );
}
