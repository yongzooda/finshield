/**
 * S-02 사전 점검 (SR-202 · F-201~203).
 *
 * **모델을 호출하지 않는다.** 구조화 폼 3문항 + 도구 반환값 템플릿 렌더링이
 * 전부다 (기능 명세 4장). Claude API가 죽어도 이 화면은 정상 동작해야 한다
 * (EX-401 — "서비스 전체가 죽은 인상 방지"의 실체가 이 화면이다).
 *
 * 진행 상태는 URL 질의 문자열로 들고 간다 (`steps.ts` 주석 참조). 링크와 GET
 * 폼만 쓰므로 스크립트 없이도 전 단계가 굴러가고, 뒤로가기가 이전 질문이 된다.
 *
 * 금지 — 자유 텍스트 입력(F-201) · 집계값 외 수치 · 특정 상품 권유·비권유 표현.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { analyzeRiskPattern } from "@/lib/tools/analyze_risk_pattern";
import { checkDocuments } from "@/lib/tools/check_documents";
import { CHANNEL_LABELS, PRODUCT_GROUPS, PRODUCT_LABELS } from "@/lib/labels";
import { SLOT_CHANNELS } from "@/lib/types";
import {
  buildResultModel,
  resolveStep,
  stepHref,
  type PrecheckStep,
  type ResultSectionKey,
} from "./steps";
import {
  NextSteps,
  RESULT_SECTION_META,
  ResultSectionBody,
  ResultSections,
} from "./views";

export const metadata: Metadata = {
  title: "가입 전 확인 — 프리케이스",
  description:
    "상품과 가입 경로를 고르면 그 조합에서 실제로 많았던 분쟁 쟁점과, 지금 확인해 두어야 할 자료를 알려드립니다.",
};

const STEP_TOTAL = 3;

/** 질문 화면의 공통 뼈대 — 한 화면에 하나의 질문 (A11Y-4) */
function Question({
  index,
  title,
  hint,
  back,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="font-bold text-accent">
        질문 {index} / {STEP_TOTAL}
      </p>
      <div aria-hidden="true" className="mt-2 flex gap-1.5">
        {Array.from({ length: STEP_TOTAL }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < index ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>
      <h1 className="mt-4 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        {title}
      </h1>
      {hint && <p className="mt-3 leading-relaxed text-fg-muted">{hint}</p>}

      <div className="mt-7">{children}</div>

      {back && (
        <p className="mt-8">
          <Link href={back.href} className="inline-flex items-center text-accent underline">
            ← {back.label}
          </Link>
        </p>
      )}
    </div>
  );
}

/** 선택지 버튼 — 열거형 질문은 자유 입력이 아니라 버튼이다 (CLAUDE.md 접근성) */
function ChoiceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-xl border-2 border-border bg-bg px-5 py-3 text-[1.05rem] font-bold text-fg no-underline shadow-sm transition-colors hover:border-accent"
    >
      <span>{children}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-5 w-5 shrink-0 text-border-strong transition-colors group-hover:text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 4.5 12.5 10 7 15.5" />
      </svg>
    </Link>
  );
}

// ─────────────────────────────────────────────── ① 상품군 — 업권 2단, 보험 기본 노출

function ProductStep({ step }: { step: Extract<PrecheckStep, { kind: "product" }> }) {
  const group = PRODUCT_GROUPS.find((g) => g.key === step.group) ?? PRODUCT_GROUPS[0];

  return (
    <Question
      index={1}
      title="어떤 상품인가요?"
      hint="가입하셨거나 가입하려는 상품을 고르세요. 정확한 이름을 모르셔도 됩니다."
    >
      {/* 업권 선택 — 보험이 기본으로 펼쳐져 있다 (기능 명세 2.3 U-7) */}
      <div role="group" aria-label="상품 분야" className="flex flex-wrap gap-2">
        {PRODUCT_GROUPS.map((g) => {
          const on = g.key === group.key;
          return (
            <Link
              key={g.key}
              href={stepHref({}, { group: g.key })}
              aria-current={on ? "true" : undefined}
              className={
                "flex items-center rounded-lg px-5 py-2 font-bold no-underline " +
                (on
                  ? "bg-accent text-accent-fg"
                  : "border-2 border-border text-fg")
              }
            >
              {g.label}
            </Link>
          );
        })}
      </div>

      <ul className="mt-5 space-y-3">
        {group.products.map((code) => (
          <li key={code}>
            <ChoiceLink href={stepHref({}, { product: code })}>
              {PRODUCT_LABELS[code]}
            </ChoiceLink>
          </li>
        ))}
      </ul>
    </Question>
  );
}

// ─────────────────────────────────────────────── ② 판매채널

function ChannelStep({ step }: { step: Extract<PrecheckStep, { kind: "channel" }> }) {
  const base = { product: step.product };

  return (
    <Question
      index={2}
      title="어디에서 가입하셨나요?"
      hint="아직 가입 전이라면 가입하려는 곳을 고르세요."
      back={{ href: stepHref({}, {}), label: "상품 다시 고르기" }}
    >
      <ul className="space-y-3">
        {SLOT_CHANNELS.map((ch) => (
          <li key={ch}>
            <ChoiceLink href={stepHref(base, { channel: ch })}>
              {CHANNEL_LABELS[ch]}
            </ChoiceLink>
          </li>
        ))}
      </ul>
    </Question>
  );
}

// ─────────────────────────────────────────────── ③ 연령

function AgeStep({ step }: { step: Extract<PrecheckStep, { kind: "age" }> }) {
  const base = { product: step.product, channel: step.channel };

  return (
    <Question
      index={3}
      title="가입하시는 분의 나이가 어떻게 되나요?"
      hint="나이에 따라 분쟁에서 다뤄지는 쟁점이 달라집니다. 본인이 아니라 가족을 대신해 확인하시는 경우에는 가입하신 분의 나이를 적어 주세요."
      back={{ href: stepHref({ product: step.product }, {}), label: "가입 경로 다시 고르기" }}
    >
      {/* GET 폼 — 스크립트 없이도 동작한다 */}
      <form action="/precheck" method="get" className="space-y-4">
        <input type="hidden" name="product" value={step.product} />
        <input type="hidden" name="channel" value={step.channel} />

        <label htmlFor="age" className="block font-bold text-fg">
          나이 (만 나이)
        </label>
        <input
          id="age"
          name="age"
          type="number"
          inputMode="numeric"
          min={19}
          max={120}
          required
          // 틀린 값을 되돌려준다 — 고령 이용자에게 재입력을 시키지 않는다.
          // 숫자가 아닌 입력은 브라우저가 무시하므로 그 경우만 빈 칸이 된다
          defaultValue={step.raw ?? ""}
          aria-describedby={step.error ? "age-error" : undefined}
          className="block w-full max-w-[10rem] rounded-lg border-2 border-border-strong px-4 py-3 text-[1.15rem] text-fg"
        />

        {step.error && (
          <p
            id="age-error"
            role="alert"
            className="rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg"
          >
            {step.error}
          </p>
        )}

        <button
          type="submit"
          className="flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg"
        >
          결과 보기
        </button>
      </form>

      <p className="mt-6">
        <Link
          href={stepHref(base, { age: "UNKNOWN" })}
          className="inline-flex items-center text-accent underline"
        >
          나이를 밝히지 않고 결과 보기
        </Link>
      </p>
    </Question>
  );
}

// ─────────────────────────────────────────────── 결과 단계

/** 결과 화면들이 공유하는 질의 문자열 — 고른 조건을 그대로 들고 다닌다 */
const resultBase = (step: Extract<PrecheckStep, { kind: "result" }>) => ({
  product: step.product,
  channel: step.channel,
  age: String(step.age),
});

/** 고르신 조건 한 줄 — 어느 화면에서든 무엇을 골랐는지 확인할 수 있어야 한다 */
function ChosenLine({ step }: { step: Extract<PrecheckStep, { kind: "result" }> }) {
  return (
    <>
      고르신 조건: {PRODUCT_LABELS[step.product]} · {CHANNEL_LABELS[step.channel]}
      {step.age !== "UNKNOWN" && ` · ${step.age}세`}
    </>
  );
}

function ResultHeader({ step }: { step: Extract<PrecheckStep, { kind: "result" }> }) {
  return (
    <header>
      <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
        이 조합에서 확인하실 것
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        <ChosenLine step={step} />
      </p>
      <p className="mt-2">
        <Link href={stepHref({}, {})} className="inline-flex items-center text-accent underline">
          조건 다시 고르기
        </Link>
      </p>
    </header>
  );
}

/**
 * 절 하나를 한 화면으로 — **입력 단계의 `Question`과 같은 뼈대다** (A11Y-4).
 *
 * 입력은 「한 화면에 하나의 질문」인데 결과만 8화면짜리 두루마리였다. 같은 화면
 * 안에서 앞뒤가 다른 원칙으로 만들어져 있던 것을 맞춘다 (2026.09.01).
 *
 * **접는 것이 아니라 나누는 것이다.** 어느 화면에서든 「전부 한 화면에서 보기」로
 * 전체를 볼 수 있고, 인쇄는 그쪽이 받는다 — 창구에 들고 갈 종이가 잘리면 안 된다.
 * 이동은 링크뿐이라 스크립트 없이 굴러가고, 뒤로가기가 이전 절이 된다.
 */
function ResultStepShell({
  step,
  sections,
  view,
  children,
}: {
  step: Extract<PrecheckStep, { kind: "result" }>;
  sections: ResultSectionKey[];
  view: ResultSectionKey;
  children: React.ReactNode;
}) {
  const meta = RESULT_SECTION_META[view];
  const index = sections.indexOf(view);
  const base = resultBase(step);
  const prev = index > 0 ? sections[index - 1] : null;
  const next = index < sections.length - 1 ? sections[index + 1] : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="font-bold text-accent">
        {sections.length}단계 중 {index + 1}단계
      </p>
      <div aria-hidden="true" className="mt-2 flex gap-1.5">
        {sections.map((k, i) => (
          <span
            key={k}
            className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>
      <h1 className="mt-4 text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
        {meta.title}
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">{meta.lead}</p>

      <div className="mt-7">{children}</div>

      {/* 마지막 절에서 다음 행동 문장 (A11Y-6). 그 앞 절들은 「다음: ○○」이 다음 행동이다 */}
      {!next && <NextSteps />}

      <nav
        aria-label="절 이동"
        className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6"
      >
        {prev ? (
          <Link
            href={stepHref(base, { view: prev })}
            className="inline-flex items-center text-accent underline"
          >
            ← {RESULT_SECTION_META[prev].short}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            href={stepHref(base, { view: next })}
            className="inline-flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg no-underline"
          >
            다음: {RESULT_SECTION_META[next].short} →
          </Link>
        )}
      </nav>

      <footer className="mt-10 border-t border-border pt-6 leading-relaxed text-fg-muted">
        <p>
          <ChosenLine step={step} />
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-7">
          <Link
            href={stepHref(base, { view: "all" })}
            className="inline-flex items-center text-accent underline"
          >
            전부 한 화면에서 보기 (인쇄용)
          </Link>
          <Link href={stepHref({}, {})} className="inline-flex items-center text-accent underline">
            조건 다시 고르기
          </Link>
        </p>
      </footer>
    </div>
  );
}

/** DB 장애 (EX-402) — 사용자 책임처럼 읽히는 문구를 쓰지 않는다 (EP-5) */
function LoadFailed() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
        지금은 사례를 불러오지 못했습니다
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        저희 쪽 자료 조회에 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.
      </p>
      <p className="mt-6">
        <Link href={stepHref({}, {})} className="inline-flex items-center text-accent underline">
          처음부터 다시 하기
        </Link>
      </p>
    </div>
  );
}

async function ResultStep({ step }: { step: Extract<PrecheckStep, { kind: "result" }> }) {
  // 채널 UNKNOWN은 「필터를 걸지 않는다」는 뜻이다 — DB 채널 열거에 UNKNOWN이 없다
  const channel = step.channel === "UNKNOWN" ? undefined : step.channel;
  const trait = step.traits.includes("ELDER") ? ("ELDER" as const) : undefined;

  let risk: Awaited<ReturnType<typeof analyzeRiskPattern>>;
  let docs: Awaited<ReturnType<typeof checkDocuments>>;
  try {
    risk = await analyzeRiskPattern({ productCode: step.product, channel, trait });
    // 화면에 보이는 쟁점과 체크리스트가 어긋나지 않게, 표시하는 쟁점을 그대로 넘긴다.
    // 약관 조항(relatedClauses)은 렌더하지 않는다 — 도구가 쟁점만으로 뽑기 때문에
    // 상품군과 무관한 조항이 섞이고, 이 화면에서는 상품과 관련 있는 것으로 읽힌다.
    docs = await checkDocuments({ issues: risk?.issues.map((i) => i.issueCode) ?? [], channel });
  } catch {
    return <LoadFailed />;
  }

  const { brief, sections } = buildResultModel({
    issues: risk?.issues.map((i) => i.issueCode) ?? [],
    product: step.product,
    // UNKNOWN은 buildBriefing이 걸러 낸다 — 전부 보기 경로와 같은 값을 넘긴다
    channel: step.channel,
  });

  // 전부 보기 — 인쇄와 데모가 이 경로를 쓴다. 본문 절은 데모(demo/prevention)와
  // 공유하는 컴포넌트다 — 갈라지면 데모만 옛 모습이 된다
  if (step.view === "all") {
    return (
      <article className="mx-auto max-w-3xl px-5 py-10">
        <ResultHeader step={step} />
        <ResultSections risk={risk} docs={docs} product={step.product} channel={step.channel} />
        <p className="mt-12 print:hidden">
          <Link
            href={stepHref(resultBase(step), { view: "ask" })}
            className="inline-flex items-center text-accent underline"
          >
            하나씩 나눠서 보기
          </Link>
        </p>
      </article>
    );
  }

  // 이번 조합에 없는 절을 요청했으면(질의 문자열은 사용자가 고칠 수 있다) 첫 절로 돌린다
  const view = sections.includes(step.view) ? step.view : sections[0];

  return (
    <ResultStepShell step={step} sections={sections} view={view}>
      <ResultSectionBody view={view} brief={brief} risk={risk} docs={docs} />
    </ResultStepShell>
  );
}

export default async function PrecheckPage({ searchParams }: PageProps<"/precheck">) {
  const step = resolveStep(await searchParams);

  switch (step.kind) {
    case "product":
      return <ProductStep step={step} />;
    case "channel":
      return <ChannelStep step={step} />;
    case "age":
      return <AgeStep step={step} />;
    case "result":
      return <ResultStep step={step} />;
  }
}
