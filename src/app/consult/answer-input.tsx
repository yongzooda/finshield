"use client";

/**
 * 되묻기 답변 입력 — **열거형은 선택지 버튼으로만 받는다.**
 *
 * 자유 입력을 두면 오입력이 슬롯 검증(F-605)에서 튕겨 같은 질문이 반복된다.
 * 「모름」은 상시 제공한다 — 모른다고 답할 방법이 없으면 이용자는 아무거나
 * 고르게 되고, 그건 틀린 슬롯이 되어 판단을 망친다 (CLAUDE.md 접근성).
 */

import { useState } from "react";
import { DEFAULT_PRODUCT_GROUP, PRODUCT_GROUPS, PRODUCT_LABELS, type AnswerForm } from "@/lib/labels";

const btn =
  "flex w-full items-center rounded-lg border-2 border-border px-5 py-3 text-left text-[1.05rem] font-bold text-fg";
const primary =
  "flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg disabled:opacity-50";

export function AnswerInput({
  form,
  disabled,
  onAnswer,
}: {
  form: AnswerForm;
  disabled: boolean;
  /** value는 서버로, display는 「지금까지 말씀하신 내용」 이력으로 간다 */
  onAnswer: (value: unknown, display: string) => void;
}) {
  if (form.kind === "choice") {
    return (
      <ul className="space-y-3">
        {form.options.map((o) => (
          <li key={o.value}>
            <button type="button" className={btn} disabled={disabled} onClick={() => onAnswer(o.value, o.label)}>
              {o.label}
            </button>
          </li>
        ))}
      </ul>
    );
  }
  if (form.kind === "product") return <ProductAnswer disabled={disabled} onAnswer={onAnswer} />;
  if (form.kind === "number") return <NumberAnswer form={form} disabled={disabled} onAnswer={onAnswer} />;
  if (form.kind === "month") return <MonthAnswer disabled={disabled} onAnswer={onAnswer} />;
  return <MultiAnswer form={form} disabled={disabled} onAnswer={onAnswer} />;
}

/** 상품군 13종 — 업권 2단, 보험 기본 노출 (S-02와 같은 구조) */
function ProductAnswer({ disabled, onAnswer }: { disabled: boolean; onAnswer: (v: unknown, display: string) => void }) {
  const [group, setGroup] = useState(DEFAULT_PRODUCT_GROUP);
  const current = PRODUCT_GROUPS.find((g) => g.key === group) ?? PRODUCT_GROUPS[0];

  return (
    <div>
      <div role="group" aria-label="상품 분야" className="flex flex-wrap gap-2">
        {PRODUCT_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={g.key === current.key}
            disabled={disabled}
            onClick={() => setGroup(g.key)}
            className={
              "flex items-center rounded-lg px-5 py-2 font-bold " +
              (g.key === current.key ? "bg-accent text-accent-fg" : "border-2 border-border text-fg")
            }
          >
            {g.label}
          </button>
        ))}
      </div>
      <ul className="mt-5 space-y-3">
        {current.products.map((code) => (
          <li key={code}>
            <button type="button" className={btn} disabled={disabled} onClick={() => onAnswer(code, PRODUCT_LABELS[code])}>
              {PRODUCT_LABELS[code]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NumberAnswer({
  form,
  disabled,
  onAnswer,
}: {
  form: Extract<AnswerForm, { kind: "number" }>;
  disabled: boolean;
  onAnswer: (v: unknown, display: string) => void;
}) {
  const [value, setValue] = useState("");
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= form.min && n <= form.max;

  return (
    <div className="space-y-4">
      <label htmlFor="answer-number" className="block font-bold text-fg">
        만 나이로 적어 주세요 ({form.min}~{form.max}{form.unit})
      </label>
      <input
        id="answer-number"
        type="number"
        inputMode="numeric"
        min={form.min}
        max={form.max}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        className="block w-full max-w-[10rem] rounded-lg border-2 border-border-strong px-4 py-3 text-[1.15rem] text-fg"
      />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} disabled={disabled || !valid} onClick={() => onAnswer(n, `${n}${form.unit}`)}>
          답변하기
        </button>
        <button type="button" className={btn + " w-auto"} disabled={disabled} onClick={() => onAnswer("UNKNOWN", "기억나지 않습니다")}>
          기억나지 않습니다
        </button>
      </div>
    </div>
  );
}

/** `2019-05` → `2019년 5월`. 화면·대화 스레드에 같은 형태로 남는다 */
export function monthLabel(ym: string): string {
  return ym.replace(/^(\d{4})-0?(\d+)$/, "$1년 $2월");
}

/** 이번 달 (`YYYY-MM`) — 가입 시점이 미래일 수는 없다 */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 가입 연월로 받을 수 있는 값인가.
 *
 * ⚠️ **`max` 속성만 믿으면 안 된다** — iOS 휠 피커는 `max`를 넘겨도 2030년까지
 * 그대로 굴려 준다(2026.08.24 실측). 형식과 상한을 여기서 다시 본다.
 * `YYYY-MM`은 사전순 비교가 곧 시간순 비교라 문자열로 견줘도 된다.
 */
export function monthAnswerable(value: string, now = thisMonth()): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= now;
}

/**
 * 가입 시점 — 유일하게 열거가 아닌 답변이다 (F-303 기준일의 근거).
 *
 * ⚠️ **iOS에서 확인한 두 가지** (2026.08.24, WKWebView · iOS 26)
 *
 * ① 값이 비어 있으면 **아무 표시도 없는 빈 상자로** 보인다. 데스크톱
 *    브라우저는 `yyyy-mm` 힌트를 그려 주지만 iOS는 그리지 않아서, 누르면
 *    무엇이 나오는지 알 수 없다. 그래서 안내 문장을 따로 둔다.
 *
 * ② **칸을 누르는 것만으로 이번 달이 채워진다.** 네이티브 휠 피커가 열리면서
 *    기본값을 그대로 onChange로 흘린다. 가입 시점은 기준일을 정하고 기준일이
 *    적용 법령을 가르므로(금소법 2021-03-25), 이용자가 고르지 않은 값이
 *    조용히 확정되면 **다른 법으로 판단한다.** 그래서 무엇을 보내는지 버튼
 *    문구에 실어 누르기 직전에 한 번 더 보이게 한다.
 */
function MonthAnswer({ disabled, onAnswer }: { disabled: boolean; onAnswer: (v: unknown, display: string) => void }) {
  const [value, setValue] = useState("");
  const valid = monthAnswerable(value);
  /** 미래 월을 고른 경우 — 버튼만 잠그면 왜 안 되는지 알 수 없다 */
  const future = /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !valid;

  return (
    <div className="space-y-4">
      <label htmlFor="answer-month" className="block font-bold text-fg">
        가입한 해와 달
      </label>
      <p className="text-fg-muted">
        아래 칸을 누르면 연도와 달을 고를 수 있습니다. 정확하지 않으면
        「기억나지 않습니다」를 고르셔도 됩니다.
      </p>
      <input
        id="answer-month"
        type="month"
        value={value}
        max={thisMonth()}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        className="block w-full max-w-[14rem] rounded-lg border-2 border-border-strong px-4 py-3 text-[1.15rem] text-fg"
      />
      {future && (
        <p role="alert" className="rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
          아직 오지 않은 달입니다. 가입하신 해와 달을 골라 주세요.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} disabled={disabled || !valid} onClick={() => onAnswer(value, monthLabel(value))}>
          {valid ? `${monthLabel(value)}로 답변하기` : "답변하기"}
        </button>
        <button type="button" className={btn + " w-auto"} disabled={disabled} onClick={() => onAnswer("UNKNOWN", "기억나지 않습니다")}>
          기억나지 않습니다
        </button>
      </div>
    </div>
  );
}

/** 복수 선택 — 「해당 없음」은 다른 것과 함께 고를 수 없다 (SlotsSchema refine) */
function MultiAnswer({
  form,
  disabled,
  onAnswer,
}: {
  form: Extract<AnswerForm, { kind: "multi" }>;
  disabled: boolean;
  onAnswer: (v: unknown, display: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (value: string) => {
    setPicked((prev) => {
      if (value === "NONE") return prev.includes("NONE") ? [] : ["NONE"];
      const next = prev.filter((p) => p !== "NONE");
      return next.includes(value) ? next.filter((p) => p !== value) : [...next, value];
    });
  };

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {form.options.map((o) => {
          const on = picked.includes(o.value);
          return (
            <li key={o.value}>
              <button
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggle(o.value)}
                className={
                  "flex w-full items-center rounded-lg px-5 py-3 text-left text-[1.05rem] font-bold " +
                  (on ? "bg-accent text-accent-fg" : "border-2 border-border text-fg")
                }
              >
                {on ? "✓ " : ""}{o.label}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={primary}
        disabled={disabled || picked.length === 0}
        onClick={() =>
          onAnswer(
            picked,
            picked.map((v) => form.options.find((o) => o.value === v)?.label ?? v).join(" · "),
          )
        }
      >
        답변하기
      </button>
    </div>
  );
}
