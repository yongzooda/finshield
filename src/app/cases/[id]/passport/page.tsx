import type { Metadata } from "next";
import { FsShell } from "../../../fs-shell";
import { PassportView } from "./passport-view";

export const metadata: Metadata = { title: "Evidence Passport | FinShield" };
export const dynamic = "force-dynamic";

export default async function PassportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FsShell>
      <PassportView caseId={id} />
    </FsShell>
  );
}
