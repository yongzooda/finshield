import type { Metadata } from "next";
import { FsShell } from "../../../fs-shell";
import { AftercareFlow } from "./aftercare-flow";

export const metadata: Metadata = { title: "가입 후 점검 | FinShield" };
export const dynamic = "force-dynamic";

export default async function AftercarePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FsShell>
      <AftercareFlow caseId={id} />
    </FsShell>
  );
}
