/**
 * FinShield 화면 껍데기.
 *
 * 들여온 PreCase 화면과 같은 색과 간격을 쓰면 같은 서비스로 보인다. 그래서
 * FinShield 쪽은 `.fs` 안에서 자기 토큰을 쓴다. PreCase 화면은 그대로 둔다.
 *
 * 상태를 색으로만 말하지 않는다. 칩에는 언제나 낱말이 함께 들어간다 (S-COM-003).
 */

import type { ReactNode } from "react";

export function FsShell({ children }: { children: ReactNode }) {
  return (
    <div className="fs min-h-[70vh]">
      <div className="fs-shell">{children}</div>
    </div>
  );
}

export function FsCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`fs-card ${className}`}>{children}</section>;
}

export type ChipTone = "verified" | "contra" | "caution" | "neutral";

export function FsChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`fs-chip fs-chip--${tone}`}>{children}</span>;
}

/** Claim 상태를 낱말과 색으로 함께 보여 준다. 색만으로 구분하지 않는다. */
export const CLAIM_STATE_VIEW: Record<string, { label: string; tone: ChipTone; help: string }> = {
  VERIFIED: { label: "확인됨", tone: "verified", help: "공식 자료로 사실임을 확인했습니다." },
  CONTRADICTED: { label: "사실과 다름", tone: "contra", help: "공식 자료가 다르게 적고 있습니다." },
  CONFLICT: { label: "자료가 엇갈림", tone: "caution", help: "공식 자료끼리 다르게 적고 있어 한쪽으로 정하지 않았습니다." },
  UNKNOWN: { label: "확인 못 함", tone: "neutral", help: "근거를 찾지 못했습니다. 안전하다는 뜻이 아닙니다." },
  NEED_MORE_INFORMATION: { label: "정보 부족", tone: "caution", help: "판단하려면 정보가 더 필요합니다." },
  WITHHELD: { label: "판단 보류", tone: "neutral", help: "확정하지 않고 보류했습니다." },
};
