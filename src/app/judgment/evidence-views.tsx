/**
 * 근거 표시 — **도구 반환 객체만 props로 받는다** (F-603 · C-6).
 *
 * 절대 규칙 1의 구현체다. 각 컴포넌트가 `LookupStatuteResult`·`PrecedentHit`·
 * `SimilarCase`를 통째로 받으므로, 모델이 만든 문자열을 여기 흘려 넣을 자리가
 * 없다. 조문·판례·사례를 화면에 내려면 **도구를 실제로 부르는 수밖에 없다.**
 *
 * ```ts
 * <StatuteCitation statute={toolResult} />   // ✅
 * <div>{llmOutput.statuteText}</div>         // ❌ 이 형태가 성립하지 않는다
 * ```
 */

import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";
import type { PrecedentHit } from "@/lib/tools/search_precedent";
import type { SimilarCase } from "@/lib/tools/search_case";
import { PRODUCT_LABELS } from "@/lib/labels";
import { statuteAnchorId } from "@/lib/agents/citations";
import { caseExcerpt } from "./compare";

/** S-05 진입 — 없으면 버튼을 그리지 않는다(근거만 보여주는 자리에서도 쓸 수 있게) */
type Openable = { onOpen?: () => void };

function MoreButton({ onOpen, label }: { onOpen?: () => void; label: string }) {
  if (!onOpen) return null;
  return (
    <p className="mt-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center rounded-lg border-2 border-accent px-5 py-2 font-bold text-accent"
      >
        {label}
      </button>
    </p>
  );
}

/**
 * 카드 안의 긴 본문을 접는다.
 *
 * ⚠️ **실기에서 나온 요구다 (2026.08.24, 카카오톡 인앱)** — 조문 원문과 사건
 * 요지가 카드마다 펼쳐져 있어 근거 섹션만 5화면을 넘었고, 그 아래
 * **「다음에 하실 일」의 신청권 명시와 1332 안내(F-306)까지 내려가는 것 자체가
 * 일**이 됐다. 화면이 요구를 담고 있어도 닿지 않으면 담지 않은 것과 같다.
 *
 * **자르지 않고 접는다.** 발췌로 줄이면 내용이 사라지지만, 접으면 한 번 눌러
 * 그대로 볼 수 있다. 폴백 배지·이관 안내·근거 공백은 **접는 대상이 아니다**
 * — 숨기면 안 되는 것들이다 (EP-1).
 */
function Fold({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group mt-3 rounded-lg border border-border bg-bg-subtle px-4 py-2">
      {/* 펼침 표시가 없으면 회색 상자가 눌리는지 알 수 없다 — 실기에서 나온 지적 */}
      <summary className="flex min-h-12 cursor-pointer list-none items-center font-bold text-fg-muted">
        <span
          aria-hidden="true"
          className="mr-2 inline-block shrink-0 text-fg-muted transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        {label}
      </summary>
      <div className="mt-1 border-t border-border pt-3">{children}</div>
    </details>
  );
}

/** 폴백 경로로 얻은 근거임을 숨기지 않는다 (EP-1 · F-702) */
function FallbackBadge({ checkedAt }: { checkedAt: string }) {
  return (
    <span className="ml-2 inline-block rounded border border-warn-border bg-warn-bg px-2 py-0.5 text-[0.85rem] font-bold text-warn-fg">
      {checkedAt} 확인 시점 기준
    </span>
  );
}

export function StatuteCitation({ statute, onOpen }: { statute: LookupStatuteResult } & Openable) {
  return (
    // 각주 링크(#statute-…)의 착지점 — 결론·쟁점 속 조문번호가 이 카드로 온다.
    // scroll-mt는 데모의 sticky 라벨에 가려지지 않게 하는 여유다
    <li
      id={statuteAnchorId(statute.lawName, statute.articleNo)}
      className="scroll-mt-16 rounded-md border border-border px-4 py-4"
    >
      <p className="text-[1.05rem] font-bold text-fg">
        {statute.lawName} {statute.articleNo}
        {statute.articleTitle && ` (${statute.articleTitle})`}
      </p>

      <p className="mt-1 text-fg-muted">
        {statute.effectiveDate ? `시행 ${statute.effectiveDate}` : "시행일 미표기"}
        {" · "}
        {statute.source === "SNAPSHOT" ? "보관된 옛 조문" : "법제처 현행 조문"}
        {statute.isFallback && <FallbackBadge checkedAt={statute.checkedAt} />}
      </p>

      <Fold label="조문 내용 보기">
        <p className="leading-relaxed text-fg">{statute.articleText}</p>
      </Fold>

      <MoreButton onOpen={onOpen} label="이 조문 자세히 보기" />

      {statute.transferredTo && (
        <p className="mt-3 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
          이 조문은 지금은 <strong>{statute.transferredTo.lawName} {statute.transferredTo.articleNo}</strong>로
          옮겨졌습니다. 가입하신 시점에는 위 조문이 적용됩니다.
          {statute.transferredTo.note && ` ${statute.transferredTo.note}`}
        </p>
      )}
    </li>
  );
}

export function PrecedentCitation({ precedent, onOpen }: { precedent: PrecedentHit } & Openable) {
  return (
    <li className="rounded-md border border-border px-4 py-4">
      <p className="text-[1.05rem] font-bold text-fg">{precedent.caseNo}</p>
      <p className="mt-1 leading-relaxed text-fg">{precedent.caseName}</p>
      <p className="mt-1 text-fg-muted">
        {precedent.courtName ?? "법원 미표기"}
        {precedent.judgmentDate && ` · 선고 ${precedent.judgmentDate}`}
      </p>
      <MoreButton onOpen={onOpen} label="이 판례 자세히 보기" />
    </li>
  );
}

/**
 * 조정례 인용. **의결일이 전부 NULL**이라(원본에 없다) 「의결번호(연도)」 형식으로
 * 적는다 — 없는 날짜를 지어내지 않는다.
 *
 * ⚠️ `compensationRate`는 렌더하지 않는다. SR-X10이 "참고 사례 n=N 기준이며
 * 예측치가 아닙니다" 병기를 요구하는데, 사례 카드마다 그 문장을 붙이면 읽히지
 * 않고, 안 붙이면 배상비율 예측으로 읽힌다. 명세가 정한 대로 **병기할 수 없으면
 * 표시하지 않는다.**
 */
export function CaseCitation({ similar, onOpen }: { similar: SimilarCase } & Openable) {
  return (
    <li className="rounded-md border border-border px-4 py-4">
      <p className="text-[1.05rem] font-bold text-fg">
        {similar.decisionNo}
        {similar.caseYear && ` (${similar.caseYear})`}
      </p>

      <p className="mt-1 text-fg-muted">
        {similar.verdict === "UPHELD" ? "배상이 인정된 사례" : "배상이 인정되지 않은 사례"}
        {similar.productCode && ` · ${PRODUCT_LABELS[similar.productCode]}`}
      </p>

      {similar.issues.length > 0 && (
        <p className="mt-1 text-fg-muted">다뤄진 쟁점 — {similar.issues.join(" · ")}</p>
      )}

      {/* 요지만 — 원문 전문은 싣지 않는다 (DR-101 · 화면 명세 S-05) */}
      <Fold label="사건 내용 보기">
        <p className="leading-relaxed text-fg">
          {caseExcerpt(similar.factsSummary).text}
          {caseExcerpt(similar.factsSummary).truncated && " …"}
        </p>
      </Fold>

      <MoreButton onOpen={onOpen} label="내 상황과 무엇이 같고 다른지 보기" />

      {similar.sourceUrl && (
        <p className="mt-3">
          <a href={similar.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline">
            금융감독원 공식 페이지에서 원문 보기
          </a>
        </p>
      )}
    </li>
  );
}

/** 근거가 비어 있는 이유를 감추지 않는다 (EP-1) */
export function EvidenceGaps({ gaps }: { gaps: readonly string[] }) {
  if (gaps.length === 0) return null;
  return (
    <div className="mt-4 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3">
      <p className="font-bold text-warn-fg">근거를 다 확보하지 못했습니다</p>
      <ul className="mt-2 space-y-1">
        {/*
          같은 공백 메시지는 조회 횟수만큼 쌓인다 (「판례 대조에 실패해…」가
          두 번 실패하면 두 줄). 똑같은 문장을 반복해 보여주는 것은 정보가 아니라
          소음이라 **문장 단위로 합치고 횟수를 병기**한다 — 몇 번 실패했는지는
          남기므로 감추는 것이 아니다 (EP-1).
        */}
        {[...gaps.reduce((m, g) => m.set(g, (m.get(g) ?? 0) + 1), new Map<string, number>())].map(
          ([g, n], i) => (
            <li key={`${i}-${g}`} className="leading-relaxed text-warn-fg">
              · {g}{n > 1 ? ` (${n}회)` : ""}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
