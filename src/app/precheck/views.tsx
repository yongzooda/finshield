/**
 * S-02 결과 단계의 표시 컴포넌트 — **도구 반환 객체만 받는다** (F-603 · C-6).
 *
 * props가 `RiskPatternResult`·`CheckDocumentsResult` 통째인 것이 핵심이다.
 * 문자열이나 숫자를 뽑아 넘기는 형태였다면 모델이 만든 값이나 컴포넌트가 지어낸
 * 값을 끼워 넣을 자리가 생긴다. 여기서는 **도구가 돌려주지 않은 것은 렌더할
 * 방법이 없다.**
 *
 * S-02 금지사항(화면 명세 S-02): 집계값 외 수치 · 특정 상품 권유·비권유 표현.
 * 그래서 백분율을 계산하지 않는다 — 집계표에 있는 건수만 그대로 쓴다.
 *
 * **이 파일은 「무엇을 그리는가」만 안다.** 절을 한 화면씩 보여줄지 전부 이어
 * 붙일지는 `page.tsx`가 정한다 — 같은 절 컴포넌트를 두 방식이 함께 쓰므로
 * 한쪽만 낡는 일이 생기지 않는다 (데모가 옛 모습으로 남아 있던 사고의 재발 방지).
 */

import Link from "next/link";
import type { CheckDocumentsResult } from "@/lib/tools/check_documents";
import type { RiskPatternResult } from "@/lib/tools/analyze_risk_pattern";
import type { Briefing } from "@/lib/precheck/briefing";
// 자료 체크리스트는 보유 표시(R-07 ③) 때문에 클라이언트 컴포넌트로 분리했다.
// 이 파일은 서버 컴포넌트로 남고, 기존 사용처를 위해 재수출한다.
import { DocumentChecklist } from "./document-checklist";
export { DocumentChecklist };
// R-09는 「판단 결과·브리핑」의 읽어주기다 — 판단 쪽과 같은 컴포넌트를 쓴다
import { ReadAloud } from "../judgment/read-aloud";
import { buildResultModel, type ResultSectionKey } from "./steps";
import type { ProductCode, SlotChannel } from "@/lib/types";
import { CHANNEL_LABELS, PRODUCT_LABELS } from "@/lib/labels";

export function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-[1.35rem] font-bold tracking-tight text-fg">
        {title}
      </h2>
      {lead && <p className="mt-2 leading-relaxed text-fg-muted">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 집계가 없을 때 — 모델 생성 일반론으로 채우지 않는다 (화면 명세 S-02 상태) */
function NoAggregate() {
  return (
    <p className="rounded-md border border-border bg-bg-subtle px-4 py-4 leading-relaxed">
      해당 조합의 사례가 충분하지 않습니다. 공개된 분쟁조정 사례에서 이 조합을 찾지
      못했습니다. 사례가 없다는 것이지, 분쟁이 생기지 않는다는 뜻은 아닙니다.
    </p>
  );
}

// ─────────────────────────────────────────────── 절의 내용

/** R-06 ① 판매자에게 확인할 질문 — 창구에서 하나씩 짚어 내려가는 목록이라 번호가 붙는다 */
function AskList({ brief }: { brief: Briefing }) {
  return (
    <>
      <ol className="space-y-3">
        {brief.questions.map((q, i) => (
          <li key={q.text} className="flex gap-3 rounded-md border border-border px-4 py-4">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[1rem] font-bold text-accent"
            >
              {i + 1}
            </span>
            <span>
              <span className="block font-bold leading-relaxed text-fg">“{q.text}”</span>
              <span className="mt-1 block text-[0.95rem] leading-relaxed text-fg-muted">
                {q.basis}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {/* R-09 — 화면에 렌더된 질문 그대로를 읽는다. 미지원 환경에서는 그려지지 않는다 */}
      <ReadAloud
        chunks={["판매자에게 확인할 것.", ...brief.questions.map((q) => q.text)]}
        label="질문 읽어주기"
      />
    </>
  );
}

/** R-06 ② 멈춤 신호 — 조정례에서 분쟁으로 이어진 반복 상황 */
function StopList({ brief }: { brief: Briefing }) {
  return (
    <>
      <ul className="space-y-3">
        {brief.signals.map((s) => (
          <li
            key={s.text}
            className="rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-4 leading-relaxed"
          >
            <p className="font-bold text-warn-fg">{s.text}</p>
            <p className="mt-1 text-[0.95rem] leading-relaxed text-fg-muted">{s.basis}</p>
          </li>
        ))}
      </ul>
      <ReadAloud
        chunks={["이런 말이 나오면 멈추세요.", ...brief.signals.map((x) => x.text)]}
        label="멈춤 신호 읽어주기"
      />
    </>
  );
}

/** R-06 해피콜 연습 진입 (SR-214) — 보험은 가입 후 확인 전화가 오는 상품군이다 */
function CallEntry() {
  return (
    <p className="print:hidden">
      <Link
        href="/happycall"
        className="inline-flex min-h-12 items-center rounded-lg border-2 border-border px-7 py-3 text-[1.05rem] font-bold text-fg no-underline"
      >
        해피콜 연습해 보기 (2분)
      </Link>
    </p>
  );
}

/**
 * A11Y-6 다음에 할 일 — 명시적 문장. 앞 절이 이미 말한 것은 여기서 반복하지 않는다.
 * 「자료를 모아 두세요」는 확인·보관 항목의 안내문으로, 「가입 시점을 확인하세요」는
 * `check_documents`의 `contract_date` 항목으로 이미 나가고 있었다 (2026.09.01 정리).
 */
export function NextSteps() {
  return (
    <Section id="next" title="다음에 하실 일">
      <p className="rounded-md border border-border px-4 py-4 leading-relaxed">
        <strong className="text-fg">설명을 들은 내용과 실제 약관이 같은지 비교해 보세요.</strong>{" "}
        다른 부분이 있으면 그 부분을 적어 두세요.
      </p>

      <div className="mt-8 rounded-lg border-2 border-accent px-5 py-5">
        <p className="text-[1.1rem] font-bold text-fg">이미 문제가 생겼다면</p>
        {/* 상품군 중립 문구 — 보험·투자·은행 어디에 와도 어색하지 않아야 한다 */}
        <p className="mt-2 leading-relaxed text-fg-muted">
          가입할 때 들은 설명과 실제가 다르거나, 청구가 거절되었거나, 예상하지 못한 손실을
          겪으셨다면 대화로 사실관계를 정리해 분쟁조정 성립 가능성을 확인해 보실 수 있습니다.
        </p>
        <p className="mt-4">
          <Link
            href="/consult"
            className="inline-flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg no-underline"
          >
            상담 시작하기
          </Link>
        </p>
      </div>
    </Section>
  );
}

// ─────────────────────────────────────────────── 절 목록과 메타

/**
 * 절의 제목·안내문. **한 화면씩 볼 때는 제목이 그 화면의 `h1`이 되고**, 전부 볼
 * 때는 `h2`가 된다. 두 방식이 같은 문구를 쓰도록 여기 한 곳에만 둔다.
 *
 * `short`는 「다음: ○○ →」 같은 이동 단추용 짧은 이름이다.
 */
export const RESULT_SECTION_META: Record<
  ResultSectionKey,
  { title: string; lead: string; short: string }
> = {
  ask: {
    title: "판매자에게 확인할 것",
    lead: "가입 전이라면 그 자리에서, 이미 가입하셨다면 지금이라도 확인을 요청할 수 있는 것들입니다.",
    short: "물어볼 것",
  },
  stop: {
    title: "이런 말이 나오면 멈추세요",
    lead: "공개된 분쟁조정 사례에서 반복된 상황입니다. 그 자리에서 결정하지 말고, 설명 자료를 요구한 뒤 확인하세요.",
    short: "멈춤 신호",
  },
  call: {
    title: "가입하면 확인 전화(해피콜)가 옵니다",
    lead: "통화는 녹음되고, 그 녹음은 나중에 분쟁이 생기면 기록으로 쓰입니다. 어떻게 답하면 되는지 미리 연습해 볼 수 있습니다.",
    short: "확인 전화",
  },
  docs: {
    title: "지금 확인해 두실 것",
    lead: "나중에 다투게 되면 아래 자료가 근거가 됩니다. 지금 한곳에 모아 두세요 — 사진으로 찍어 두어도 됩니다.",
    short: "챙길 자료",
  },
  why: {
    title: "이런 문제가 많았습니다",
    lead: "앞의 질문과 자료 목록이 이렇게 나온 근거입니다. 공개된 분쟁조정 사례에서 이 조합에 자주 등장한 쟁점입니다.",
    short: "근거",
  },
};

/** 절 하나의 내용. 제목·안내문은 감싸는 쪽이 그린다 */
export function ResultSectionBody({
  view,
  brief,
  risk,
  docs,
}: {
  view: ResultSectionKey;
  brief: Briefing;
  risk: RiskPatternResult | null;
  docs: CheckDocumentsResult;
}) {
  switch (view) {
    case "ask":
      return <AskList brief={brief} />;
    case "stop":
      return <StopList brief={brief} />;
    case "call":
      return <CallEntry />;
    case "docs":
      return <DocumentChecklist result={docs} />;
    case "why":
      return risk ? <RiskPatterns result={risk} /> : <NoAggregate />;
  }
}

/**
 * 전부 이어 붙인 화면 (`view=all`) — 인쇄해 창구에 들고 가는 경로가 여기에 걸린다.
 * 데모(`/demo/prevention`)도 이것을 쓴다: 심사위원이 한 장에서 전부 본다.
 *
 * 한 화면씩 보는 경로와 **같은 절 컴포넌트**를 쓴다. 갈라지면 한쪽만 낡는다.
 */
export function ResultSections({
  risk,
  docs,
  product,
  channel,
}: {
  risk: RiskPatternResult | null;
  docs: CheckDocumentsResult;
  product: ProductCode;
  channel?: SlotChannel;
}) {
  const { brief, sections } = buildResultModel({
    issues: risk?.issues.map((i) => i.issueCode) ?? [],
    product,
    channel,
  });

  return (
    <>
      {sections.map((key) => (
        <Section
          key={key}
          id={key}
          title={RESULT_SECTION_META[key].title}
          lead={RESULT_SECTION_META[key].lead}
        >
          <ResultSectionBody view={key} brief={brief} risk={risk} docs={docs} />
        </Section>
      ))}
      <NextSteps />
    </>
  );
}

/** 집계 기준 코드를 사람 문장으로. 형식을 못 알아보면 코드를 그대로 보인다 */
function basisText(statBasis: string): string {
  const m = /^DECISION_(\d+)$/.exec(statBasis);
  return m ? `정식 결정서 ${m[1]}건` : statBasis;
}

/** 어떤 축으로 집계를 읽었는지 — 요청과 다를 수 있으므로 `matched`를 그대로 쓴다 */
function matchedText(matched: RiskPatternResult["matched"]): string {
  const parts: string[] = [];
  if (matched.productCode) parts.push(PRODUCT_LABELS[matched.productCode]);
  if (matched.channel) parts.push(CHANNEL_LABELS[matched.channel]);
  // 「고령」이라는 말을 이용자에게 돌려주지 않는다 (화면 명세 S-02) — 사실만 적는다
  if (matched.trait === "ELDER") parts.push("60세 이상 가입자");
  return parts.length ? parts.join(" · ") : "전체 사례";
}

export function RiskPatterns({ result }: { result: RiskPatternResult }) {
  return (
    <div>
      <p className="leading-relaxed text-fg-muted">
        <strong className="text-fg">{matchedText(result.matched)}</strong> 기준으로 집계한
        결과입니다. ({basisText(result.statBasis)} 중)
      </p>

      {result.fellBack && (
        <p className="mt-3 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
          고르신 조합에 딱 맞는 사례가 충분하지 않아, <strong>더 넓은 기준으로</strong> 집계한
          결과를 보여드립니다. 위에 적힌 기준이 실제로 집계한 범위입니다.
        </p>
      )}

      {/* 카드가 아니라 구분선 행이다 — 이 절은 앞 행동 목록의 근거이지 그와 덩치를
          겨루는 항목이 아니다. 건수는 하나도 줄이지 않는다 (F-202) */}
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {result.issues.map((issue) => (
          <li key={issue.issueCode} className="py-3">
            <p className="font-bold text-fg">{issue.issueLabel}</p>
            <p className="mt-0.5 text-[0.95rem] leading-relaxed text-fg-muted">
              분쟁조정 사례 {issue.nCases}건 — 배상이 인정된 사례 {issue.nUpheld}건 · 인정되지
              않은 사례 {issue.nRejected}건
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
        위 숫자는 지금까지 공개된 조정 사례를 센 것입니다. 앞으로의 결과를 예측한 값이
        아니며, 같은 쟁점이라도 사건마다 판단이 달라집니다.
      </p>
    </div>
  );
}
