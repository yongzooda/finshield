import type { Metadata } from "next";
import { FsShell } from "../../../fs-shell";
import { JourneyForm } from "./journey-form";

export const metadata: Metadata = { title: "가입·피해 사실 등록 | FinShield" };
export const dynamic = "force-dynamic";

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <FsShell>
      <JourneyForm caseId={id} />
    </FsShell>
  );
}
