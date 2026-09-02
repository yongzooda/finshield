/**
 * S-04 판단 결과 (SR-204 · F-306) — 결론 상태와 유보 상태.
 *
 * F-306은 표시 항목을 **한 벌로** 요구한다. 일부만 렌더하는 코드가 통과하면
 * 안 되므로, 필수 요소는 전부 이 파일의 고정 구조 안에 있다.
 *
 * 「가능성 낮음」·유보에 반드시 들어가는 4가지:
 *   ① 신청권이 이용자에게 있음 ② 금감원 1332 ③ 말리는 표현 금지
 *   ④ 판단이 달라지는 조건
 * ①②③은 ④ 안내 계층(`guide.ts`)이 코드로 붙이고 잘라낸다 — 화면은 그 결과를
 * 그대로 싣는다. ④는 판단 결과에서 온다.
 *
 * 금지 — "배상받을 수 있습니다" 확정 표현 · 금융회사 실명 평가 · 백분율 변환.
 */

import { annotateStatutes, stripUnbackedCitations } from "@/lib/agents/citations";
import { ReadAloud } from "./read-aloud";
import type { GuideResult } from "@/lib/agents/guide";
import type { Evidence, Judgment, JudgmentOutcome } from "@/lib/agents/types";
import { CHANNEL_LABELS, PRODUCT_LABELS, WITHHELD_REASON_TEXTS } from "@/lib/labels";
import type { Slots } from "@/lib/types";

/** G-3 — 판단·근거가 보이는 화면은 본문 상단에도 면책 고지를 고정한다 */
export function Disclaimer() {
  return (
    <p className="rounded-md border-l-4 border-border-strong bg-bg-subtle px-4 py-3 leading-relaxed">
      <strong className="text-fg">이 결과는 법률 자문이 아닙니다.</strong> 공개된 분쟁조정
      선례와 법령을 근거로 한 참고 정보이며, 실제 조정 결과를 예단하지 않습니다.
    </p>
  );
}

/**
 * 확신도 — 숫자와 뜻을 함께 적는다. **백분율·승소 확률로 바꾸지 않는다**
 * (CLAUDE.md 절대 규칙 4). 5점 만점의 자기평가지 확률이 아니다.
 */
function Confidence({ value }: { value: number }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-bg-subtle px-4 py-4">
      <div className="flex items-center gap-3">
        <p className="text-[1.15rem] font-bold text-fg">확신도 {value} / 5</p>
        {/* 시각 보조일 뿐이라 스크린리더에는 숨긴다. 백분율·게이지가 아니라 5점 만점 그대로다 */}
        <span aria-hidden="true" className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full ${i <= value ? "bg-accent" : "border border-border-strong bg-bg"}`}
            />
          ))}
        </span>
      </div>
      <p className="mt-1 leading-relaxed text-fg-muted">
        {/* JSX는 텍스트와 태그 사이의 줄바꿈을 지우므로 문장 사이 공백을 명시한다 */}
        근거가 서로 다른 방향을 가리키거나 확인되지 않은 사실이 많으면 낮아집니다.{" "}
        <strong>이길 가능성을 나타내는 값이 아니며</strong>, 백분율로 바꿔 읽으실 수 없습니다.
      </p>
    </div>
  );
}

/** 무엇을 근거로 판단했는지 되짚어 보인다. 미확인 항목을 감추지 않는다 (기획서 9.2) */
export function BasisSlots({ slots }: { slots: Slots }) {
  const rows: { label: string; value: string; unknown: boolean }[] = [
    { label: "상품", value: PRODUCT_LABELS[slots.product], unknown: slots.product === "ETC_UNKNOWN" },
    { label: "가입 경로", value: CHANNEL_LABELS[slots.channel], unknown: slots.channel === "UNKNOWN" },
    {
      label: "가입 당시 나이",
      value: slots.age === "UNKNOWN" ? "확인되지 않음" : `${slots.age}세`,
      unknown: slots.age === "UNKNOWN",
    },
    {
      label: "가입 시점",
      value: slots.contract_ym === "UNKNOWN" ? "확인되지 않음" : slots.contract_ym,
      unknown: slots.contract_ym === "UNKNOWN",
    },
  ];

  const missing = rows.filter((r) => r.unknown);

  return (
    <div>
      <dl className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap gap-x-3">
            <dt className="font-bold text-fg">{r.label}</dt>
            <dd className={r.unknown ? "text-warn-fg" : "text-fg-muted"}>{r.value}</dd>
          </div>
        ))}
      </dl>

      {missing.length > 0 && (
        <p className="mt-4 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
          <strong>확인되지 않은 항목이 {missing.length}가지 있습니다.</strong> 이 부분이
          확인되면 판단이 달라질 수 있습니다.
        </p>
      )}
    </div>
  );
}

/**
 * 긴 산문을 문장 경계에서 2~3문장씩 문단으로 나눈다.
 *
 * **글자를 더하거나 빼지 않는다** — 「다. 」 뒤에서만 자르고 다시 이어 붙이면
 * 원문과 동일하다(공백 포함). 모델 산문을 다듬는 것이 아니라 표시만 나누는
 * 것이라 환각 방지 대조(N-405)와 무관하다. 테스트가 무손실을 고정한다.
 */
export function paragraphs(text: string, perPara = 3): string[] {
  const sentences = text.split(/(?<=다\.)\s+/);
  if (sentences.length <= perPara) return [text];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += perPara) {
    out.push(sentences.slice(i, i + perPara).join(" "));
  }
  return out;
}

/**
 * ① 결론 문장 + 확신도.
 *
 * ⚠️ `guide.explanation`은 **모델이 쓴 산문**이다. 그대로 렌더하면
 * 「민법 제750조에 따라…」처럼 도구가 반환한 적 없는 인용이 화면에 나간다 —
 * CLAUDE.md가 금지한 `<div>{llmOutput.statuteText}</div>` 바로 그 형태다.
 * ④ 안내 계층에서도 거르지만, **화면이 다시 대조해야 「나올 수 없다」가 된다**
 * (N-405 대조 테스트가 이 구멍을 잡아냈다).
 */
export function Conclusion({
  judgment,
  guide,
  evidence,
}: {
  judgment: Judgment;
  guide: GuideResult;
  evidence: Evidence;
}) {
  const safe = stripUnbackedCitations(guide.explanation, evidence);

  return (
    <div>
      <h2 className="rounded-2xl bg-navy px-5 py-4 text-[1.5rem] font-bold leading-snug tracking-tight text-white">
        {guide.headline}
      </h2>
      {/* 실측 655자 한 문단이 그대로 나가고 있었다 — 주 사용자(고령층)가 읽을 수 없다.
          문장 경계로만 끊으므로 글자는 하나도 달라지지 않는다 */}
      {paragraphs(safe.text).map((p, i) => (
        <p key={i} className="mt-4 leading-relaxed text-fg">
          {/* 조문번호는 근거 카드로 잇는다 — 스트리퍼를 지난 텍스트라 남은 인용은 전부 근거가 있다 */}
          <CitedText text={p} evidence={evidence} />
        </p>
      ))}
      {/* R-09 읽어주기 — 화면에 렌더된 문자열 그대로를 읽는다. 미지원 환경에서는 그려지지 않는다 */}
      <ReadAloud chunks={[guide.headline, ...paragraphs(safe.text)]} label="결론 읽어주기" />
      <Confidence value={judgment.confidence} />
    </div>
  );
}

/** ② 쟁점 목록 */
/**
 * 산문 속 조문번호를 근거 카드로 잇는다 (근거 각주).
 *
 * `annotateStatutes`가 **근거 실물과 대조된 조각만** 링크로 돌려준다 — 대조에
 * 실패한 인용은 평문 그대로 남는다. 링크 문자열은 원문 부분 문자열이라 글자가
 * 달라질 수 없다(무손실은 citations 테스트가 고정).
 */
export function CitedText({ text, evidence }: { text: string; evidence: Evidence }) {
  const segs = annotateStatutes(text, evidence.statutes);
  return (
    <>
      {segs.map((s, i) =>
        s.kind === "statute" ? (
          <a
            key={i}
            href={`#${s.anchorId}`}
            // after 가상요소가 보이지 않는 탭 영역을 세로로 넓힌다 — 산문 속
            // 인라인 링크는 글줄 높이(21px)뿐이라 A11Y-2(48px)에 못 미친다.
            // 시각 디자인은 그대로 두고 히트 영역만 21+14×2=49px로 만든다
            className="relative font-bold text-accent underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-[14px] after:content-['']"
            aria-label={`${s.text} — 근거 법령으로 이동`}
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function Issues({ issues, evidence }: { issues: readonly string[]; evidence: Evidence }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {issues.map((issue, i) => (
        <li key={`${i}-${issue}`} className="rounded-md border border-border bg-bg-subtle px-3 py-2 font-bold text-fg">
          <CitedText text={issue} evidence={evidence} />
        </li>
      ))}
    </ul>
  );
}

/** ⑤ 다음 단계 — 신청권·1332는 ④ 안내 계층이 코드로 붙인다. 화면은 그대로 싣는다 */
export function NextSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="rounded-md border border-border px-4 py-4 leading-relaxed text-fg">
          {s}
        </li>
      ))}
    </ol>
  );
}

/**
 * ④ 판단이 달라지는 조건 (F-306 ④) — 결론이든 유보든 반드시 보인다.
 * 이것도 모델 텍스트라 근거 없는 인용이 든 항목은 뺀다 (F-603).
 */
export function ChangesIf({
  conditions,
  evidence,
}: {
  conditions: readonly string[];
  evidence: Evidence;
}) {
  const kept = conditions.filter((c) => stripUnbackedCitations(c, evidence).removed === 0);
  if (kept.length === 0) return null;
  return (
    <ul className="space-y-3">
      {/* 모델이 만든 문장이라 같은 내용이 두 번 올 수 있다 — 문자열 key 금지 */}
      {kept.map((c, i) => (
        <li key={`${i}-${c}`} className="rounded-md border border-border px-4 py-4 leading-relaxed text-fg">
          {c}
        </li>
      ))}
    </ul>
  );
}

/** 유보 사유 문구의 정본은 어휘집에 있다 — 안내 계층(guideWithheld)과 같은 문장을 쓴다 */
export { WITHHELD_REASON_TEXTS } from "@/lib/labels";

export function WithheldReason({
  outcome,
}: {
  outcome: Extract<JudgmentOutcome, { kind: "WITHHELD" }>;
}) {
  return (
    <p className="leading-relaxed text-fg">{WITHHELD_REASON_TEXTS[outcome.reason]}</p>
  );
}

/** ③ "이 자료가 있으면 판단할 수 있습니다" — 항목으로 나눈다 (한 줄로 뭉치면 못 읽는다) */
export function NeededItems({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-3">
      {items.map((n, i) => (
        <li key={`${i}-${n}`} className="rounded-md border border-border px-4 py-4 leading-relaxed text-fg">
          {n}
        </li>
      ))}
    </ul>
  );
}
