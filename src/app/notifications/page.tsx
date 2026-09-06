import type { Metadata } from "next";
import { FsShell } from "../fs-shell";
import { NotificationCenter } from "./notification-center";

export const metadata: Metadata = { title: "알림 | FinShield" };
export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <FsShell>
      <NotificationCenter />
    </FsShell>
  );
}
