/**
 * ③ 개선 축 기관 화면의 공통 조각.
 *
 * 소비자 화면과 **같은 규율**을 따른다 — 퍼센트를 혼자 두지 않고, 표본이 얇으면
 * 얇다고 말하고, 색으로만 정보를 전하지 않는다. 기관용이라고 해서 수치를
 * 느슨하게 보여주면 이 서비스가 검증 결과 화면(S-06)에서 세운 원칙이 무너진다.
 */

import { CHANNEL_LABELS } from "@/lib/labels";
import { SMALL_SAMPLE_N } from "@/lib/insight/aggregate";
import type { DbChannel, DbTrait } from "@/lib/types";

export const TRAIT_KO: Record<DbTrait, string> = {
  ELDER: "고령",
  INEXP: "투자 경험 부족",
  CAPACITY: "판단 능력 제약",
  PRO: "전문투자자",
};

/**
 * 코드 → 한국어. **표에 없는 코드는 감추지 않고 원래 이름 그대로 내보낸다** —
 * 새 채널이 조용히 사라지면 「실패는 표시한다」(EP-1)가 깨진다. 실행 로그가
 * 모르는 키를 원어로 내보내는 것과 같은 처리다.
 */
export function channelKo(c: DbChannel): string {
  return CHANNEL_LABELS[c] ?? c;
}

/** 표본이 얇은 줄에 붙는다. 「이 수치 하나로 판단하지 말라」는 뜻 */
export function SmallSample({ n }: { n: number }) {
  if (n >= SMALL_SAMPLE_N) return null;
  return (
    <span className="ml-2 inline-block rounded border border-warn-border bg-warn-bg px-2 py-0.5 text-[0.85rem] font-bold text-warn-fg">
      사례 {n}건 — 표본 부족
    </span>
  );
}

/**
 * 인용·기각 분포 막대.
 *
 * 숫자를 **항상 함께** 적는다. 막대만 두면 색을 못 보는 사람에게 아무 정보가
 * 없고, 3건과 30건이 같은 길이로 보일 수 있다.
 */
export function VerdictBar({ upheld, rejected }: { upheld: number; rejected: number }) {
  const total = upheld + rejected;
  if (total === 0) return <p className="text-fg-muted">결론이 분류된 사례가 없습니다</p>;
  const pct = Math.round((upheld / total) * 100);
  return (
    <div>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`배상 인정 ${upheld}건, 인정되지 않음 ${rejected}건`}
      >
        <div className="bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-fg-muted">
        배상 인정 <strong className="text-fg">{upheld}건</strong> · 인정되지 않음{" "}
        <strong className="text-fg">{rejected}건</strong>
      </p>
    </div>
  );
}

/** 화면마다 맨 위에 붙는 모집단 고지 — 무엇을 세었는지가 먼저다 */
export function Population({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="mt-4 rounded-md border border-border bg-bg-subtle px-4 py-3 leading-relaxed text-fg-muted">
      {children}
    </p>
  );
}

/**
 * 기관 화면 전체에 붙는 고지.
 *
 * **이용자 상담 내용은 집계에 들어가지 않는다.** 소비자가 자기 상담이 금융회사에
 * 전달될 수 있다고 의심하면 서비스가 성립하지 않는다(기획서 9.3). 화면에서
 * 한 번 더 말한다 — 코드에서는 애초에 읽을 것이 없다.
 */
export function InsightNotice() {
  return (
    <div className="mt-6 rounded-md border-l-4 border-accent bg-accent-soft px-4 py-3">
      <p className="leading-relaxed text-fg">
        <strong>공개된 분쟁조정 사례만 집계합니다.</strong> 프리케이스를 이용한 분의
        상담 내용은 저장되지 않으므로 이 지표에 들어갈 수 없습니다.
      </p>
    </div>
  );
}

/** 특정 금융회사를 지목하지 않는다는 고지 (SR-X04) */
export function NoCompanyNotice() {
  return (
    <p className="mt-4 leading-relaxed text-fg-muted">
      집계는 채널·쟁점·상품 단위입니다. 원자료에 회사명이 없고,{" "}
      <strong className="text-fg">특정 금융회사를 지목하거나 평가하지 않습니다.</strong>
    </p>
  );
}
