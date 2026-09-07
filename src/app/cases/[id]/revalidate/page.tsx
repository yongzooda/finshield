import type { Metadata } from "next";
import { FsShell } from "../../../fs-shell";
import { RevalidateFlow } from "./revalidate-flow";

export const metadata: Metadata = { title: "다시 확인하기 | FinShield" };
export const dynamic = "force-dynamic";

export default async function RevalidatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ job_id?: string }> }) {
  const { id } = await params;
  const requestedJob = (await searchParams).job_id ?? null;
  return (
    <FsShell>
      <RevalidateFlow key={`${id}:${requestedJob}`} caseId={id} requestedJob={requestedJob} />
    </FsShell>
  );
}
