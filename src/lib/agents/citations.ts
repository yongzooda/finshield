/**
 * 인용 대조 — **근거에 없는 조문·사건번호·의결번호를 걸러낸다** (F-603 · N-405).
 *
 * `server-only`를 import하지 않는다. **렌더링 계층에서도 써야 하기 때문이다.**
 * CLAUDE.md 절대 규칙 1은 「프롬프트 지시가 아니라 렌더링 계층에서 구조적으로
 * 강제한다」이고, 그러려면 화면이 직접 대조할 수 있어야 한다.
 *
 * 두 곳에서 건다:
 *   1. ④ 안내 계층 — 모델이 쓴 산문에서 지어낸 인용을 뺀다
 *   2. 화면 — 그래도 들어온 payload가 가짜 인용을 그리지 못하게 한다
 *
 * 왜 두 번인가: ①만 두면 「모델 출력을 거른다」는 약속이고, ②가 있어야
 * 「화면에 나올 수 없다」는 **구조**가 된다.
 */

import type { Evidence } from "./types";

const PATTERNS: readonly RegExp[] = [
  /제\s*\d+\s*조(?:\s*의\s*\d+)?/g, // 조문번호
  /\d{2,4}\s*[가-힣]{1,2}\s*\d{3,6}/g, // 사건번호 (2010다76368)
  /제\s*\d{4}\s*-\s*\d+\s*호/g, // 의결번호 (제2019-15호)
];

const norm = (s: string) => s.replace(/\s/g, "");

/** 도구가 실제로 반환한 인용 표기 집합 */
export function backedCitations(evidence: Evidence): Set<string> {
  return new Set<string>([
    ...evidence.statutes.map((x) => norm(x.articleNo)),
    ...evidence.precedents.map((x) => norm(x.caseNo)),
    ...evidence.cases.map((x) => norm(x.decisionNo)),
  ]);
}

/** 이 문장에 근거 없는 인용이 있는가 */
export function hasUnbackedCitation(sentence: string, backed: Set<string>): boolean {
  for (const re of PATTERNS) {
    for (const m of sentence.matchAll(new RegExp(re.source, re.flags))) {
      if (!backed.has(norm(m[0]))) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────── 근거 각주 (R-06~08 스프린트 · S-04)

/** 근거 법령 카드의 앵커 id — 각주 링크와 카드가 같은 규칙을 쓴다 */
export function statuteAnchorId(lawName: string, articleNo: string): string {
  return `statute-${norm(lawName + articleNo)}`;
}

export type CitedSegment =
  | { kind: "text"; text: string }
  | { kind: "statute"; text: string; anchorId: string };

/** 법령명 대조용 접두 — 본문은 「자본시장법」처럼 줄여 부르기도 해서 앞 3자로 가른다 */
const lawKey = (lawName: string) => norm(lawName).slice(0, 3);

/**
 * 산문 속 조문번호를 **근거 실물과 대조해** 링크 조각으로 나눈다.
 *
 * 원칙은 배지의 반대 방향이다 — **확실히 대조된 것만 링크하고, 애매하면
 * 평문으로 둔다.** 링크가 하나 빠지는 것은 손해가 아니지만, 다른 조문으로
 * 잘못 잇는 것은 없는 근거를 만드는 일이다 (F-603과 같은 태도).
 *
 *   · 조문번호가 근거 법령 중 정확히 하나와 일치할 때만 잇는다
 *   · 같은 조문번호가 여러 법령에 있으면, 직전 문맥의 법령명으로만 가른다 —
 *     못 가르면 링크하지 않는다
 *   · 직전에 **다른** 법령명이 붙어 있으면 잇지 않는다 — 「민법 제651조」를
 *     상법 제651조 카드로 보내는 사고를 막는다
 *
 * 조문번호 탐지는 위 PATTERNS[0]과 같은 표기 기준이다. 세그먼트를 이어 붙이면
 * 원문 그대로다(무손실) — 테스트가 고정한다.
 */
export function annotateStatutes(
  text: string,
  statutes: Evidence["statutes"],
): CitedSegment[] {
  if (statutes.length === 0 || !text) return [{ kind: "text", text }];

  const out: CitedSegment[] = [];
  let last = 0;

  for (const m of text.matchAll(/제\s*\d+\s*조(?:\s*의\s*\d+)?/g)) {
    const idx = m.index ?? 0;
    const cited = norm(m[0]);
    const before = text.slice(Math.max(0, idx - 30), idx);

    const hits = statutes.filter((s) => norm(s.articleNo) === cited);
    let target: Evidence["statutes"][number] | null = null;
    if (hits.length === 1) {
      target = hits[0];
      // 직전에 법령명이 붙어 있는데 대상 법령이 아니면 잇지 않는다
      const named = /([가-힣]{1,20}법(?:률)?)\s*$/.exec(before)?.[1];
      if (named && !norm(target.lawName).includes(norm(named))) target = null;
    } else if (hits.length > 1) {
      const byName = hits.filter((s) => before.includes(lawKey(s.lawName)));
      target = byName.length === 1 ? byName[0] : null;
    }
    if (!target) continue;

    if (idx > last) out.push({ kind: "text", text: text.slice(last, idx) });
    out.push({
      kind: "statute",
      text: m[0],
      anchorId: statuteAnchorId(target.lawName, target.articleNo),
    });
    last = idx + m[0].length;
  }

  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.length ? out : [{ kind: "text", text }];
}

/**
 * 근거에 없는 인용이 든 문장을 **통째로** 뺀다.
 * 부분 치환은 뜻이 뒤틀린다 — `stripDiscouraging`과 같은 태도다.
 */
export function stripUnbackedCitations(
  text: string,
  evidence: Evidence,
): { text: string; removed: number } {
  const backed = backedCitations(evidence);
  const sentences = text.split(/(?<=[.!?。]|다\.)\s+/);
  const kept = sentences.filter((s) => !hasUnbackedCitation(s, backed));
  return { text: kept.join(" ").trim(), removed: sentences.length - kept.length };
}
