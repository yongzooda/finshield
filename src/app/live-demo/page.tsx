import type { Metadata } from "next";
import { FsShell } from "../fs-shell";
import { DemoRunner } from "./demo-runner";

export const metadata: Metadata = { title: "서비스 체험 | FinShield" };
export const dynamic = "force-dynamic";

export default function LiveDemoPage() {
  return (
    <FsShell>
      <DemoRunner />
    </FsShell>
  );
}
