/**
 * S-05 근거 상세 (SR-205 · F-401) — S-04의 근거 **하나**를 깊이 본다.
 *
 * 근거 유형별 필수 구성(화면 명세 S-05):
 *   조정례 — 요지 · **공통점/차이점 대비** · 결론 · 의결번호 · 금감원 공식 페이지 링크
 *   법령   — 조문 원문 · 시행일 · 출처·확인 시점 (F-501)
 *   판례   — 사건번호 · 요지 · **대조 성공 표시**
 *
 * ⚠️ 조정례 **원문 전문은 표시하지 않는다** (DR-101 라이선스) — 요지와 링크까지다.
 * ⚠️ 유사사례는 **판단의 근거가 아니라 이해를 돕는 참고**임을 화면에서 구분한다
 *    (기획서 6.5). 판단 계층은 조정례를 프롬프트에 넣지 않는다 — 이 화면의 존재
 *    이유가 「그럼 이건 뭐냐」에 답하기 위해서다.
 *
 * 전이는 S-04 복귀만 (T-3).
 */

import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";
import type { PrecedentHit } from "@/lib/tools/search_precedent";
import type { SimilarCase } from "@/lib/tools/search_case";
import type { Slots } from "@/lib/types";
import { caseExcerpt, compareCase, similaritySentence } from "./compare";

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center rounded-lg border-2 border-border px-6 py-3 text-[1.05rem] font-bold text-fg"
    >
      ← 결과로 돌아가기
    </button>
  );
}

function Frame({
  eyebrow,
  title,
  onBack,
  children,
}: {
  eyebrow: string;
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-fg-muted">{eyebrow}</p>
      <h1 className="mt-2 text-[1.7rem] font-bold leading-tight tracking-tight text-fg">{title}</h1>
      <div className="mt-8">{children}</div>
      <div className="mt-12">
        <Back onBack={onBack} />
      </div>
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[1.2rem] font-bold tracking-tight text-fg">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// ─────────────────────────────────────────────── 조정례

export function CaseDetail({
  similar,
  slots,
  issues,
  referenceCount,
  onBack,
}: {
  similar: SimilarCase;
  slots: Slots;
  issues: readonly string[];
  /** 배상비율 병기에 쓰는 참고 사례 수 (SR-X10) */
  referenceCount: number;
  onBack: () => void;
}) {
  const cmp = compareCase(slots, issues, similar);

  return (
    <Frame
      eyebrow="참고 조정례"
      title={`${similar.decisionNo}${similar.caseYear ? ` (${similar.caseYear})` : ""}`}
      onBack={onBack}
    >
      {/* 기획서 6.5 — 판단 입력이 아니라 설명 근거임을 먼저 밝힌다 */}
      <p className="rounded-md border-l-4 border-border-strong bg-bg-subtle px-4 py-3 leading-relaxed">
        <strong className="text-fg">이 사례는 판단의 근거가 아닙니다.</strong> 비슷한 상황에서
        어떤 결론이 났는지 <strong className="text-fg">이해를 돕기 위한 참고 자료</strong>입니다.
        결론은 법령과 사실관계로 내렸습니다.
      </p>

      <Block title="이 사건은 어떻게 끝났나">
        <p className="text-[1.1rem] font-bold text-fg">
          {similar.verdict === "UPHELD" ? "배상이 인정되었습니다" : "배상이 인정되지 않았습니다"}
        </p>
        {similar.compensationRate !== null && (
          <p className="mt-2 leading-relaxed text-fg-muted">
            인정된 배상비율 {similar.compensationRate}% —{" "}
            <strong className="text-warn-fg">
              참고 사례 {referenceCount}건 중 이 한 건의 결과이며 예측치가 아닙니다.
            </strong>
          </p>
        )}
      </Block>

      <Block title="어떤 사건이었나">
        {/*
          요지만 싣는다. 결정서 본문은 실측 1,258~15,956자라 그대로 붙이면
          원문 재현이 되고(DR-101), 고령 이용자가 읽을 수도 없다.
        */}
        {(() => {
          const ex = caseExcerpt(similar.factsSummary, 700);
          return (
            <>
              <p className="leading-relaxed text-fg">{ex.text}{ex.truncated && " …"}</p>
              <p className="mt-3 leading-relaxed text-fg-muted">
                {ex.truncated
                  ? "결정서 앞부분만 옮긴 요지입니다. 원문 전문은 싣지 않으며, 아래 금융감독원 공식 페이지에서 확인하실 수 있습니다."
                  : "원문 전문은 싣지 않습니다. 아래 금융감독원 공식 페이지에서 확인하실 수 있습니다."}
              </p>
            </>
          );
        })()}
      </Block>

      {/* F-401 핵심 — 본인 사건과의 공통점·차이점 */}
      <Block title="내 상황과 무엇이 같고 다른가">
        <p className="leading-relaxed text-fg-muted">{similaritySentence(cmp)}</p>

        {cmp.issues.shared.length > 0 && (
          <div className="mt-4 rounded-md border border-border px-4 py-4">
            <p className="font-bold text-fg">같은 쟁점</p>
            <p className="mt-1 leading-relaxed text-fg">{cmp.issues.shared.join(" · ")}</p>
          </div>
        )}

        {cmp.axes.same.length > 0 && (
          <ul className="mt-3 space-y-2">
            {cmp.axes.same.map((a) => (
              <li key={a.label} className="rounded-md border border-border px-4 py-3 leading-relaxed">
                <span className="font-bold text-fg">{a.label}</span> — 둘 다 {a.value}
              </li>
            ))}
          </ul>
        )}

        {cmp.axes.different.length > 0 && (
          <div className="mt-6">
            <p className="font-bold text-fg">다른 점</p>
            <ul className="mt-2 space-y-2">
              {cmp.axes.different.map((d) => (
                <li key={d.label} className="rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
                  <span className="font-bold">{d.label}</span> — 내 사건은 {d.mine}, 이 사례는 {d.theirs}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(cmp.axes.unknown.length > 0 || cmp.issues.unconfirmed.length > 0) && (
          <div className="mt-6">
            <p className="font-bold text-fg">견줄 수 없는 항목</p>
            <ul className="mt-2 space-y-2">
              {cmp.axes.unknown.map((u) => (
                <li key={u.label} className="rounded-md border border-border px-4 py-3 leading-relaxed text-fg-muted">
                  <span className="font-bold text-fg">{u.label}</span> — {u.reason}
                </li>
              ))}
              {/* 조정례에는 붙어 있으나 내 쟁점 서술에서 확인되지 않는 태그.
                  「이 사례에만 있다」고 단정하면 거짓 차이가 된다 — 형식이 다를 뿐이다 */}
              {cmp.issues.unconfirmed.length > 0 && (
                <li className="rounded-md border border-border px-4 py-3 leading-relaxed text-fg-muted">
                  <span className="font-bold text-fg">쟁점</span> — 이 사례에는{" "}
                  {cmp.issues.unconfirmed.join(" · ")} 쟁점 분류가 붙어 있는데, 내 사건에서 이
                  쟁점을 다뤘는지는 위의 판단 내용으로 확인해 보세요
                </li>
              )}
            </ul>
          </div>
        )}
      </Block>

      {similar.sourceUrl && (
        <Block title="원문 보기">
          <a href={similar.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline">
            금융감독원 공식 페이지에서 이 사례 원문 보기
          </a>
        </Block>
      )}
    </Frame>
  );
}

// ─────────────────────────────────────────────── 법령

export function StatuteDetail({
  statute,
  onBack,
}: {
  statute: LookupStatuteResult;
  onBack: () => void;
}) {
  return (
    <Frame
      eyebrow="근거 법령"
      title={`${statute.lawName} ${statute.articleNo}`}
      onBack={onBack}
    >
      {statute.articleTitle && (
        <p className="text-[1.1rem] font-bold text-fg">{statute.articleTitle}</p>
      )}

      <Block title="조문">
        <p className="leading-relaxed text-fg">{statute.articleText}</p>
      </Block>

      {/* F-501 — 출처와 확인 시점을 반드시 함께 */}
      <Block title="이 조문을 어디서 가져왔나">
        <dl className="space-y-2">
          <div className="flex flex-wrap gap-x-3">
            <dt className="font-bold text-fg">시행일</dt>
            <dd className="text-fg-muted">{statute.effectiveDate ?? "원본에 표기가 없습니다"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="font-bold text-fg">출처</dt>
            <dd className="text-fg-muted">
              {statute.source === "SNAPSHOT"
                ? "지금은 삭제된 옛 조문이라 보관본에서 가져왔습니다"
                : "법제처 국가법령정보 현행 조문"}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="font-bold text-fg">확인 시점</dt>
            <dd className="text-fg-muted">{statute.checkedAt}</dd>
          </div>
        </dl>

        {statute.isFallback && (
          <p className="mt-4 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
            조회가 원활하지 않아 <strong>{statute.checkedAt} 확인 시점의 보관본</strong>을
            보여드리고 있습니다. 그 뒤에 바뀐 내용이 있을 수 있습니다.
          </p>
        )}
      </Block>

      {statute.transferredTo && (
        <Block title="이 조문은 옮겨졌습니다">
          <p className="leading-relaxed text-fg">
            지금은 <strong>{statute.transferredTo.lawName} {statute.transferredTo.articleNo}</strong>에
            들어 있습니다. 다만 <strong>가입하신 시점에는 위 조문이 적용</strong>됩니다.
          </p>
          {statute.transferredTo.note && (
            <p className="mt-2 leading-relaxed text-fg-muted">{statute.transferredTo.note}</p>
          )}
        </Block>
      )}
    </Frame>
  );
}

// ─────────────────────────────────────────────── 판례

export function PrecedentDetail({
  precedent,
  onBack,
}: {
  precedent: PrecedentHit;
  onBack: () => void;
}) {
  return (
    <Frame eyebrow="근거 판례" title={precedent.caseNo} onBack={onBack}>
      {/*
        대조 성공 표시 (화면 명세 S-05). `evidence.precedents`에는 사건번호가
        정확히 일치한 것만 담긴다 — 법제처 검색이 부분일치로 동작해 무관한 사건이
        1순위로 오는 결함이 실측돼 있어(연동 명세 E-02), 대조를 통과했다는 사실
        자체가 표시할 값이다.
      */}
      <p className="rounded-md border-l-4 border-accent bg-bg-subtle px-4 py-3 leading-relaxed">
        <strong className="text-fg">사건번호를 정확히 대조해 확인한 판례입니다.</strong>{" "}
        법제처 검색은 비슷한 번호도 함께 돌려주기 때문에, 요청한 사건번호와 글자까지
        일치하는 것만 근거로 씁니다.
      </p>

      <Block title="사건">
        <p className="leading-relaxed text-fg">{precedent.caseName}</p>
      </Block>

      <Block title="어느 법원, 언제">
        <dl className="space-y-2">
          <div className="flex flex-wrap gap-x-3">
            <dt className="font-bold text-fg">법원</dt>
            <dd className="text-fg-muted">{precedent.courtName ?? "원본에 표기가 없습니다"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="font-bold text-fg">선고일</dt>
            <dd className="text-fg-muted">{precedent.judgmentDate ?? "원본에 표기가 없습니다"}</dd>
          </div>
        </dl>
      </Block>
    </Frame>
  );
}
