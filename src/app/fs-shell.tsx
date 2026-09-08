/**
 * FinShield 화면 껍데기.
 *
 * 들여온 PreCase 화면과 같은 색과 간격을 쓰면 같은 서비스로 보인다. 그래서
 * FinShield 쪽은 `.fs` 안에서 자기 토큰을 쓴다. PreCase 화면은 그대로 둔다.
 *
 * 상태를 색으로만 말하지 않는다. 칩에는 언제나 낱말이 함께 들어간다 (S-COM-003).
 */

import type { ReactNode } from "react";

export function FsShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="fs min-h-[70vh]">
      <div className={`fs-shell${wide ? " fs-shell--wide" : ""}`}>{children}</div>
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
  VERIFIED: { label: "공식 자료와 일치", tone: "verified", help: "입력한 내용이 확인한 공식 자료와 일치합니다." },
  CONTRADICTED: { label: "공식 자료와 불일치", tone: "contra", help: "공식 자료가 다르게 적고 있습니다." },
  CONFLICT: { label: "자료가 엇갈림", tone: "caution", help: "공식 자료끼리 다르게 적고 있어 한쪽으로 정하지 않았습니다." },
  UNKNOWN: { label: "확인 근거 부족", tone: "neutral", help: "확정에 필요한 근거가 충분하지 않습니다." },
  NEED_MORE_INFORMATION: { label: "추가 정보 필요", tone: "caution", help: "판단하려면 정보가 더 필요합니다." },
  WITHHELD: { label: "판단 보류", tone: "neutral", help: "확정하지 않고 보류했습니다." },
};

/** 행동 경고가 사실 판정의 UNKNOWN·보류 상태를 덮어쓰지 않는다. */
export const isHighRiskReason = (reason?: string) => reason === "HIGH_RISK_ADVANCE_PAYMENT" || reason === "HIGH_RISK_REMOTE_CONTROL";
export function claimViewOf(status: string, reason?: string) {
  const view = CLAIM_STATE_VIEW[status] ?? { label: "판단 상태 확인 필요", tone: "neutral" as const, help: "판단 상태를 확인하지 못했습니다." };
  return status === "CONTRADICTED" && isHighRiskReason(reason)
    ? { ...view, label: "공식 예방 지침과 불일치", help: "이 요구가 공식 예방 지침에 맞는지 비교한 결과입니다." } : view;
}
