import { FsCard, FsChip, claimViewOf, isHighRiskReason } from "./fs-shell";
import { limitationLabel, partialExplanation, runStatusLabel, reasonLabel, coveLabel } from "./fs-labels";

/** RES-008: 검토 실패와 위험 행동을 구분하며 원본 Run·Passport 값은 바꾸지 않는다. */
export function ReviewNotice({ status, reasons = [] }: { status: string; reasons?: readonly string[] }) {
  if (["COMPLETED", "SUCCEEDED"].includes(status) && reasons.length === 0) return null;
  const pending = ["QUEUED", "RUNNING"].includes(status);
  const partial = status === "PARTIAL" || (["COMPLETED", "SUCCEEDED"].includes(status) && reasons.length > 0);
  const explanation = partialExplanation(reasons);
  return <FsCard>
    <FsChip tone="caution">{pending ? "검토 진행 중" : partial ? "일부 검토 미완료" : runStatusLabel(status)}</FsChip>
    <p className="fs-body mt-2">{pending
      ? "공식 자료와 대조하고 있습니다. 완료되면 이 화면에 결과가 표시됩니다."
      : partial ? "일부 검토를 끝내지 못했습니다. 아래에서 완료된 검토 결과와 확인하지 못한 항목을 구분해 보실 수 있습니다."
        : "이번 검토를 완료하지 못했습니다. 기록에서 상태를 확인한 뒤 다시 시도해 주세요."}</p>
    {!pending && explanation.causes.length > 0 ? <ul className="fs-body mt-2 list-disc space-y-1 pl-5">
      {explanation.causes.map(cause => <li key={cause}>{cause}</li>)}
    </ul> : null}
    {!pending && explanation.areas.length > 0 ? <p className="fs-meta mt-2">
      검토가 제한된 범위: {explanation.areas.join(" · ")}
    </p> : null}
  </FsCard>;
}

export function ClaimBadges({ status, reason }: { status: string; reason?: string }) {
  const view = claimViewOf(status, reason);
  return <div className="flex flex-wrap gap-2">
    {isHighRiskReason(reason) ? <FsChip tone="contra">위험한 행동 요구</FsChip> : null}
    <FsChip tone={view.tone}>{view.label}</FsChip>
  </div>;
}

export function ResultScopeNote() {
  return <p className="fs-meta mt-2">입력한 권유 내용이 공식 자료와 맞는지 비교한 결과입니다. 위험한 행동 요구와 사실 확인 결과는 별도로 표시합니다.</p>;
}

export function AxisLimitations({ codes = [] }: { codes?: readonly string[] | null }) {
  const messages = [...new Set((codes ?? []).map(limitationLabel))];
  if (!messages.length) return null;
  return <div className="mt-2">
    <p className="fs-meta font-semibold">판단의 한계</p>
    <ul className="fs-meta mt-1 list-disc space-y-1 pl-5">{messages.map(message => <li key={message}>{message}</li>)}</ul>
  </div>;
}

export function ClaimReviewDetails({ reason, cove, redTeam }: { reason?: string; cove?: string; redTeam?: string }) {
  return <details className="fs-details mt-2">
    <summary>판단 과정과 검토 상태</summary>
    <ul className="fs-meta mt-2 list-disc space-y-1 pl-5">
      {reason ? <li>{reasonLabel(reason)}</li> : null}
      {cove && cove !== "NOT_REQUIRED" ? <li>독립 재확인: {coveLabel(cove)}</li> : null}
      {redTeam && redTeam !== "NOT_REQUIRED" ? <li>{redTeam === "COUNTER_EVIDENCE" ? "반대 근거 탐색에서 초기 판단과 다른 근거를 찾았습니다."
        : redTeam === "FAILED" ? "반대 근거 탐색을 완료하지 못했습니다." : "반대 근거 탐색만으로 별도 결론을 확정하지 않았습니다."}</li> : null}
    </ul>
  </details>;
}
