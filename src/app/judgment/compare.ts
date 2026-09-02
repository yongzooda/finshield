/**
 * 본인 사건 ↔ 참조 조정례 대비 (F-401 · S-05 핵심).
 *
 * **모델을 쓰지 않는다.** 양쪽 다 구조화 값이라 코드로 맞대볼 수 있다 —
 * 확정 슬롯(이용자가 답한 것)과 `SimilarCase`의 필드(도구가 반환한 것)를
 * 축별로 비교할 뿐이다. 그래서 여기서 나온 문장은 **지어낼 여지가 없다**
 * (F-603을 프롬프트가 아니라 구조로 지키는 또 하나의 자리).
 *
 * 모르는 축은 「같다」로도 「다르다」로도 넣지 않는다. 조정례 라벨은 부착률이
 * 축마다 다르고(채널 125/388), 비어 있는 것을 일치로 읽으면 없는 공통점을
 * 만들어내게 된다.
 */

import { CHANNEL_LABELS, PRODUCT_LABELS } from "@/lib/labels";
import type { SimilarCase } from "@/lib/tools/search_case";
import type { Slots } from "@/lib/types";

export type CaseComparison = {
  /** 공통점 — 양쪽 다 값이 있고 같은 축 */
  same: { label: string; value: string }[];
  /** 차이점 — 양쪽 다 값이 있고 다른 축 */
  different: { label: string; mine: string; theirs: string }[];
  /** 한쪽이라도 값이 없어 견줄 수 없는 축. 감추지 않고 그대로 밝힌다 */
  unknown: { label: string; reason: string }[];
};

/**
 * 쟁점 대조 결과.
 *
 * ⚠️ 두 축은 **형식이 다르다.** 내 쟁점(`myIssues`)은 판단 계층이 쓴 문장이고,
 * 조정례 쟁점(`c.issues`)은 분류 태그 31종(「설명의무」 등)이다. 동등 비교를
 * 하면 교집합이 항상 비어서, 설명의무 사건을 보면서도 「이 사례에만 있는
 * 쟁점 — 설명의무」라는 **거짓 차이**가 화면에 나갔다 (2026.08.23 실주행 발견).
 *
 * 그래서 태그가 내 쟁점 문장 안에 나타나는지로 대조한다. 나타나지 않는 태그는
 * 「이 사례에 없다」가 아니라 「내 서술에서 확인되지 않았다」일 뿐이므로,
 * 차이점이 아니라 견줄 수 없는 항목으로 다룬다 — 빈 라벨을 일치로 읽지 않는
 * 것과 같은 원칙이다(S-05).
 */
export type IssueOverlap = {
  /** 조정례 태그 중 내 쟁점 서술에서도 확인되는 것 */
  shared: string[];
  /** 조정례에서 다뤄졌으나 내 쟁점 서술에서 확인되지 않는 태그 */
  unconfirmed: string[];
  /** 어느 태그와도 대응되지 않은 내 쟁점 서술 개수 — 문장 원문은 S-04에 이미 있다 */
  unmatchedMine: number;
};

export function compareCase(
  slots: Slots,
  myIssues: readonly string[],
  c: SimilarCase,
): { axes: CaseComparison; issues: IssueOverlap } {
  const axes: CaseComparison = { same: [], different: [], unknown: [] };

  // ── 상품군
  const myProduct = slots.product;
  if (myProduct === "ETC_UNKNOWN") {
    axes.unknown.push({ label: "상품", reason: "가입하신 상품이 특정되지 않았습니다" });
  } else if (c.productCode === null) {
    axes.unknown.push({ label: "상품", reason: "이 조정례에는 상품군 분류가 붙어 있지 않습니다" });
  } else if (c.productCode === myProduct) {
    axes.same.push({ label: "상품", value: PRODUCT_LABELS[myProduct] });
  } else {
    axes.different.push({
      label: "상품",
      mine: PRODUCT_LABELS[myProduct],
      theirs: PRODUCT_LABELS[c.productCode],
    });
  }

  // ── 판매채널
  if (slots.channel === "UNKNOWN") {
    axes.unknown.push({ label: "가입 경로", reason: "가입 경로가 확인되지 않았습니다" });
  } else if (c.channel === null) {
    axes.unknown.push({ label: "가입 경로", reason: "이 조정례에는 판매채널 분류가 붙어 있지 않습니다" });
  } else if (c.channel === slots.channel) {
    axes.same.push({ label: "가입 경로", value: CHANNEL_LABELS[slots.channel] });
  } else {
    axes.different.push({
      label: "가입 경로",
      mine: CHANNEL_LABELS[slots.channel],
      theirs: CHANNEL_LABELS[c.channel],
    });
  }

  // ── 쟁점 — 태그 ⊂ 문장 포함 대조 (타입 주석 참조. 동등 비교는 거짓 차이를 만든다)
  const theirs = [...new Set(c.issues)];
  const shared = theirs.filter((t) => myIssues.some((m) => m.includes(t)));
  const issues: IssueOverlap = {
    shared,
    unconfirmed: theirs.filter((t) => !shared.includes(t)),
    unmatchedMine: myIssues.filter((m) => !theirs.some((t) => m.includes(t))).length,
  };

  return { axes, issues };
}

/**
 * 한국어 조사를 받침에 맞춰 고른다.
 *
 * 「가입 경로이(가)」처럼 두 형태를 함께 적는 표기는 고령 이용자가 읽기에
 * 껄끄럽다. 한글 음절은 `(코드 - 0xAC00) % 28`이 0이 아니면 받침이 있으므로
 * 규칙으로 정확히 고를 수 있다.
 */
export function withParticle(word: string, withBatchim: string, withoutBatchim: string): string {
  const last = word.trim().at(-1) ?? "";
  const code = last.charCodeAt(0);
  // 한글 음절 영역이 아니면(숫자·영문 등) 받침 없는 쪽으로 둔다
  if (code < 0xac00 || code > 0xd7a3) return word + withoutBatchim;
  return word + ((code - 0xac00) % 28 === 0 ? withoutBatchim : withBatchim);
}

/**
 * 얼마나 닮았는지를 한 문장으로. **점수·백분율을 만들지 않는다** —
 * 「72% 유사」 같은 수치는 도구가 준 적 없는 값이고, 이용자는 그걸 승산으로 읽는다.
 */
export function similaritySentence(cmp: ReturnType<typeof compareCase>): string {
  const { axes, issues } = cmp;
  if (issues.shared.length === 0 && axes.same.length === 0) {
    return "겹치는 조건을 찾지 못했습니다. 참고용으로만 보시기 바랍니다.";
  }

  const parts: string[] = [];
  if (issues.shared.length) parts.push(`쟁점 ${issues.shared.length}가지`);
  if (axes.same.length) parts.push(axes.same.map((s) => s.label).join("·"));

  // 「A와 B가 같습니다」 — 앞 항목에는 와/과, 마지막 항목에는 이/가
  const joined = parts.length === 2 ? withParticle(parts[0], "과", "와") + " " + parts[1] : parts[0];
  const same = withParticle(joined, "이", "가") + " 같습니다.";

  if (axes.different.length === 0) return same;
  const diffLabels = axes.different.map((d) => d.label).join("·");
  return `${same} 다만 ${withParticle(diffLabels, "은", "는")} 다릅니다.`;
}

// ─────────────────────────────────────── 조정례 요지 발췌

/**
 * 조정례 본문에서 **요지만** 뽑는다.
 *
 * `factsSummary`는 결정서의 [기초사실] 구간이라 실측 **1,258~15,956자**(중앙값
 * 5,007)다. 그대로 실으면 두 가지가 깨진다:
 *
 *   1. **DR-101 라이선스** — 화면 명세 S-05가 「원문 전문 미표시, 공식 페이지
 *      링크」로 정해 뒀다. 5천 자를 붙여놓고 "전문은 싣지 않습니다"라고 적으면
 *      말과 화면이 다르다
 *   2. **읽을 수 없다** — 고령 이용자가 주 사용자다 (A11Y)
 *
 * 문장 경계에서 자른다. 중간에서 끊으면 뜻이 바뀔 수 있다.
 */
export function caseExcerpt(
  factsSummary: string,
  limit = 320,
): { text: string; truncated: boolean } {
  const clean = factsSummary.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return { text: clean, truncated: false };

  const head = clean.slice(0, limit);
  // 마지막 문장 끝(다./다) 뒤에서 자른다. 못 찾으면 어절 경계로 물러난다
  const sentence = Math.max(head.lastIndexOf("다. "), head.lastIndexOf("다.\n"));
  const cut = sentence > limit * 0.4 ? sentence + 2 : head.lastIndexOf(" ");
  return { text: clean.slice(0, cut > 0 ? cut : limit).trim(), truncated: true };
}
