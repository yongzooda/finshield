import type { Metadata } from "next";
import { FsShell } from "../../../fs-shell";
import { PassportView } from "./passport-view";

export const metadata: Metadata = { title: "검증 근거 기록 | FinShield" };
export const dynamic = "force-dynamic";

export default async function PassportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ passport_id?: string }> }) {
  const { id } = await params;
  const requestedPassport = (await searchParams).passport_id ?? null;
  return (
    <FsShell>
      <PassportView key={`${id}:${requestedPassport}`} caseId={id} requestedPassport={requestedPassport} />
    </FsShell>
  );
}
