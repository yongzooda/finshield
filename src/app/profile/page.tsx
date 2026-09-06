import type { Metadata } from "next";
import { FsShell } from "../fs-shell";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "금융 프로필 | FinShield" };
export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return (
    <FsShell>
      <ProfileForm />
    </FsShell>
  );
}
