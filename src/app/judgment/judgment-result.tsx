/**
 * S-04 판단 결과 (SR-204) — 결론 상태 A / 유보 상태 B.
 *
 * 화면 명세가 정한 순서를 그대로 따른다:
 *   A. ① 결론+확신도 ② 쟁점 ③ 근거 3분류 ④ 자료 체크리스트
 *      ⑤ 다음 단계 ⑥ 신고 버튼 ⑦ 실행 로그
 *   B. ① 유보 문장 ② 사유 ③ 필요한 자료 ④ 재상담+1332 ⑤ 실행 로그
 *
 * S-07(자료 체크리스트)·S-08(실행 로그)은 **독립 화면을 만들지 않고 여기에
 * 흡수**한다 — 범위 문서 9장의 축소 순서 1·2단계이며, 항목은 축약하지 않는다.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DocumentChecklist } from "../precheck/views";
import { CaseCitation, EvidenceGaps, PrecedentCitation, StatuteCitation } from "./evidence-views";
import { ExecutionLog } from "./execution-log";
import { ReportForm } from "./report-form";
import { SavePrint } from "./save-print";
import {
  BasisSlots,
  ChangesIf,
  Conclusion,
  Disclaimer,
  Issues,
  NeededItems,
  NextSteps,
  WithheldReason,
  WITHHELD_REASON_TEXTS,
} from "./result-views";
import { ReadAloud } from "./read-aloud";
import { useFocusOnChange } from "../consult/announce";
import { keepReconsult } from "../consult/session-store";
import { ProcedureGuide } from "./procedure";
import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";
import { CaseDetail, PrecedentDetail, StatuteDetail } from "./evidence-detail";
import type { JudgmentDone } from "./types";

/**
 * S-05로 넘어간 상태. **별도 route로 두지 않았다** — 근거는 판단 스트림이 끝난
 * 순간의 클라이언트 메모리에만 있어서, 페이지를 새로 열면 되살릴 방법이 판단을
 * 다시 돌리는 것뿐이다(모델 비용 100초). 대신 `history.pushState`로 주소를 바꿔
 * **뒤로가기가 S-04 복귀(T-3)로 동작**하게 했다.
 */
type Selected =
  | { type: "statute"; key: string }
  | { type: "precedent"; key: string }
  | { type: "case"; key: string }
  | null;

function Section({
  id,
  title,
  lead,
  printHidden,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  /** 종이에서는 쓸 수 없는 대화형 영역 — 인쇄본에서 뺀다 */
  printHidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={"mt-12" + (printHidden ? " print:hidden" : "")}>
      {/* 앵커로 건너뛸 때 고정 머리말에 제목이 가리지 않도록 여백을 둔다 */}
      <h2 id={id} className="scroll-mt-20 text-[1.35rem] font-bold tracking-tight text-fg">
        {title}
      </h2>
      {lead && <p className="mt-2 leading-relaxed text-fg-muted">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** ③ 근거 3분류 — 도구가 반환하지 않은 분류는 렌더되지 않는다 (F-603) */
function EvidenceSections({
  evidence,
  onOpen,
}: {
  evidence: JudgmentDone["evidence"];
  onOpen: (s: Selected) => void;
}) {
  const empty =
    evidence.statutes.length === 0 &&
    evidence.precedents.length === 0 &&
    evidence.cases.length === 0;

  return (
    <>
      {evidence.statutes.length > 0 && (
        <Section
          id="statutes"
          title="근거 법령"
          lead="가입하신 시점에 적용되던 조문입니다. 법이 바뀐 경우 바뀐 사실도 함께 적었습니다."
        >
          <ul className="space-y-3">
            {evidence.statutes.map((s) => (
              <StatuteCitation
                key={`${s.lawName}${s.articleNo}`}
                statute={s}
                onOpen={() => onOpen({ type: "statute", key: `${s.lawName}${s.articleNo}` })}
              />
            ))}
          </ul>
        </Section>
      )}

      {evidence.precedents.length > 0 && (
        <Section
          id="precedents"
          title="근거 판례"
          lead="사건번호를 정확히 대조해 확인된 판례만 싣습니다."
        >
          <ul className="space-y-3">
            {evidence.precedents.map((p) => (
              <PrecedentCitation
                key={p.caseNo}
                precedent={p}
                onOpen={() => onOpen({ type: "precedent", key: p.caseNo })}
              />
            ))}
          </ul>
        </Section>
      )}

      {evidence.cases.length > 0 && (
        <Section
          id="cases"
          title="참고 조정례"
          lead="비슷한 사건에서 어떤 결론이 났는지 보여드리는 자료입니다. 판단의 입력이 아니라 이해를 돕는 참고입니다."
        >
          <ul className="space-y-3">
            {evidence.cases.map((c) => (
              <CaseCitation
                key={c.decisionNo}
                similar={c}
                onOpen={() => onOpen({ type: "case", key: c.decisionNo })}
              />
            ))}
          </ul>
        </Section>
      )}

      {empty && (
        <Section id="no-evidence" title="근거">
          <p className="rounded-md border border-border bg-bg-subtle px-4 py-4 leading-relaxed">
            이번에는 인용할 수 있는 근거를 확보하지 못했습니다. 없는 근거를 지어내지 않습니다.
          </p>
        </Section>
      )}

      <EvidenceGaps gaps={evidence.gaps} />
    </>
  );
}

export function JudgmentResult({
  done,
  /**
   * 절차 안내 조문 (R-07 ②). 서버가 조회해 넘긴다. 데모는 넘기지 않으므로
   * 절차 흐름만 나오고 조문 카드는 비는데, **데모가 외부 조회를 하지 않는다는
   * 성질(DR-107)을 지키기 위해서다** — 조문은 D-3 데모 재생성 때 번들에 싣는다.
   */
  procedureStatutes = [],
}: {
  done: JudgmentDone;
  procedureStatutes?: readonly LookupStatuteResult[];
}) {
  const { outcome, guide, evidence, slots, trace } = done;
  const withheld = outcome.kind === "WITHHELD";
  const [selected, setSelected] = useState<Selected>(null);
  const heading = useFocusOnChange(withheld);

  const open = useCallback((s: Selected) => {
    setSelected(s);
    // 주소를 바꿔 뒤로가기가 결과 화면 복귀가 되게 한다 (T-3)
    if (s) history.pushState({ evidence: s }, "", `?evidence=${s.type}:${encodeURIComponent(s.key)}`);
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => history.back(), []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      setSelected((e.state as { evidence?: Selected } | null)?.evidence ?? null);
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── S-05 근거 상세 (SR-205)
  if (selected) {
    if (selected.type === "statute") {
      const st = evidence.statutes.find((x) => `${x.lawName}${x.articleNo}` === selected.key);
      if (st) return <StatuteDetail statute={st} onBack={back} />;
    }
    if (selected.type === "precedent") {
      const pr = evidence.precedents.find((x) => x.caseNo === selected.key);
      if (pr) return <PrecedentDetail precedent={pr} onBack={back} />;
    }
    if (selected.type === "case") {
      const c = evidence.cases.find((x) => x.decisionNo === selected.key);
      if (c) {
        return (
          <CaseDetail
            similar={c}
            slots={slots}
            issues={outcome.kind === "CONCLUDED" ? outcome.judgment.issues : []}
            referenceCount={evidence.cases.length}
            onBack={back}
          />
        );
      }
    }
  }

  return (
    <article className="mx-auto max-w-3xl px-5 py-10">
      {/* G-3 — 본문 상단 고정 면책 고지 */}
      <Disclaimer />

      <header className="mt-8">
        {/* 살펴보는 중 → 결과로 바뀌는 순간이 이 서비스에서 가장 중요한 전환이다.
            눈으로 보면 명백하지만 스크린리더에는 아무 일도 아니다 (A11Y-7) */}
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-[1.9rem] font-bold leading-tight tracking-tight text-navy"
        >
          {withheld ? "지금 정보로는 판단을 유보합니다" : "살펴본 결과입니다"}
        </h1>

        {/*
          결과 화면은 길다 — 근거·자료를 다 싣기 때문이다. 그런데 F-306이 요구하는
          **신청권 명시와 1332 안내**는 그 아래 「다음에 하실 일」에 있다. 실기
          (2026.08.24, 카카오톡 인앱)에서 「내려가기 힘들다」는 지적을 받았다.
          화면이 요구를 담고 있어도 닿지 않으면 담지 않은 것과 같아서, 맨 위에서
          바로 가는 길을 연다. 순서(명세 S-04 ①\~⑦)는 그대로 둔다.
        */}
        <p className="mt-4 print:hidden">
          <a
            href="#next"
            className="inline-flex items-center rounded-lg border-2 border-border px-5 py-2 font-bold text-accent no-underline print:hidden"
          >
            다음에 하실 일 바로 보기 ↓
          </a>
        </p>
      </header>

      {withheld ? (
        <>
          {/* B② 유보 사유 — 실패·오류 톤을 쓰지 않는다 (F-307) */}
          <Section id="reason" title="왜 유보했는지">
            <WithheldReason outcome={outcome} />
            <p className="mt-3 leading-relaxed text-fg-muted">
              결론을 내지 못한 것이지, 신청할 수 없다는 뜻이 아닙니다. 아래 자료가 보태지면
              다시 살펴볼 수 있습니다.
            </p>
            {/* R-09 읽어주기 — 유보 화면도 같은 권리다. 화면 문자열 그대로를 읽는다 */}
            <ReadAloud
              chunks={[
                "지금 정보로는 판단을 유보합니다.",
                WITHHELD_REASON_TEXTS[outcome.reason],
                "결론을 내지 못한 것이지, 신청할 수 없다는 뜻이 아닙니다. 아래 자료가 보태지면 다시 살펴볼 수 있습니다.",
              ]}
              label="안내 읽어주기"
            />
          </Section>

          {/*
            B③ + F-306 ④ — 유보 상태에도 「판단이 달라지는 조건」이 필요하다.
            유보에서는 이 목록이 그 역할을 한다: 이 자료가 확인되면 판단이 달라진다.
            제목이 아니라 안내 문장에서 그 연결을 분명히 적는다.
          */}
          <Section
            id="needed"
            title="이 자료가 있으면 판단할 수 있습니다"
            lead="아래 자료가 확인되면 판단이 달라질 수 있습니다."
          >
            <NeededItems items={guide.needed} />
          </Section>
        </>
      ) : (
        <>
          {/* A① 결론 + 확신도 */}
          <Section id="conclusion" title="결론">
            <Conclusion judgment={outcome.judgment} guide={guide} evidence={evidence} />
          </Section>

          {/* A② 쟁점 목록 */}
          {outcome.judgment.issues.length > 0 && (
            <Section id="issues" title="다뤄진 쟁점">
              <Issues issues={outcome.judgment.issues} evidence={evidence} />
            </Section>
          )}
        </>
      )}

      {/* 무엇을 근거로 판단했는지 + 미확인 항목 (기획서 9.2) */}
      <Section id="basis" title="이 내용을 바탕으로 살펴봤습니다">
        <BasisSlots slots={slots} />
      </Section>

      {/* A③ 근거 3분류 */}
      <EvidenceSections evidence={evidence} onOpen={open} />

      {/* A④ 자료 체크리스트 — S-07 흡수. 항목을 축약하지 않는다 */}
      {evidence.documents && (
        <Section
          id="documents"
          title="준비하실 자료"
          lead="분쟁조정을 신청하시거나 다시 살펴볼 때 근거가 되는 자료입니다."
        >
          <DocumentChecklist result={evidence.documents} />
        </Section>
      )}

      {/* 판단이 달라지는 조건 (F-306 ④) — 결론이든 유보든, 값이 있으면 보인다 */}
      {guide.changesIf.length > 0 && (
        <Section
          id="changes"
          title="이런 경우 판단이 달라집니다"
          lead="아래 사정이 확인되면 결과가 바뀔 수 있습니다."
        >
          <ChangesIf conditions={guide.changesIf} evidence={evidence} />
        </Section>
      )}

      {/* A⑤ / B④ 다음 단계 — 신청권·1332는 ④ 안내 계층이 코드로 붙인 것이다 */}
      <Section id="next" title="다음에 하실 일">
        <NextSteps steps={guide.nextSteps} />

        {withheld && (
          <p className="mt-6">
            <Link
              href="/consult"
              className="inline-flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg no-underline print:hidden"
              onClick={() => {
                // 유보 이어가기 (F-308 확장) — 재봉인 세션과 필요 자료 목록을 들고
                // S-03으로 돌아간다. 화면 명세 4.2 「기존 세션의 상담 맥락 유지」.
                // 세션이 없으면(데모 사례) 지금까지처럼 새 상담으로 간다.
                if (done.session) keepReconsult(done.session, guide.needed);
                // DR-302 — 유보 후 재상담 전환율 측정. 횟수만 센다
                void fetch("/api/event", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ event: "RECONSULT_ENTRY" }),
                });
              }}
            >
              자료를 보태서 다시 상담하기
            </Link>
          </p>
        )}
      </Section>

      {/*
        분쟁조정 절차·자료 확보 안내 (R-07 ② · SR-204 확장).
        결론이든 유보든 같은 내용을 보인다 — 신청권은 결과와 무관하게
        이용자에게 있다(기획서 9.5 ①). 축소 순서 0-4는 이 섹션의 제거를 뜻한다.
      */}
      <Section
        id="procedure"
        title="분쟁조정은 이렇게 진행됩니다"
        lead="신청부터 결과까지의 흐름과, 자료를 구하실 수 있는 근거입니다."
      >
        <ProcedureGuide statutes={procedureStatutes} />
      </Section>

      {/* A⑥ 신고 (F-404) — 종이에서는 쓸 수 없으므로 인쇄에서 뺀다 */}
      <Section id="report" title="사실과 다른 점이 있다면" printHidden>
        <ReportForm />
      </Section>

      {/* A⑦ / B⑤ 실행 로그 — S-08 흡수, 접이식 */}
      <Section id="log" title="판단 과정">
        <ExecutionLog entries={trace} />
      </Section>

      {/* 로그인·이력 저장을 두지 않는 대신, 기록을 이용자 손에 남긴다 */}
      <Section id="keep" title="이 결과를 남겨 두시려면">
        <SavePrint />
      </Section>
    </article>
  );
}
