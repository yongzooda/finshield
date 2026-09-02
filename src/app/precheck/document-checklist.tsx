"use client";

/**
 * 자료 체크리스트 — 보유 표시 연동 (F-309 · R-07 ③ · SR-207 확장).
 *
 * 각 자료에 「가지고 있어요」 체크를 둔다. 체크 상태는 **이 컴포넌트의
 * 상태에만** 있다 — 서버 전송·저장이 없고(P-3), 새로고침하면 사라진다.
 * 의미 규약은 `check_documents`의 possessed와 같다: 결여 = 필요 − 보유.
 * 도구가 possessed를 받아 계산하는 것을 화면에서는 같은 셈으로 지역
 * 계산한다 — 체크 한 번에 서버를 부를 이유가 없다.
 *
 * 인쇄(S-04 저장·인쇄)에서는 체크 표시가 찍힌 상태 그대로 나간다 —
 * 창구에 들고 가는 종이에서 「이건 이미 있음」이 보이는 것이 목적이다.
 */

import { useState } from "react";
import type { CheckDocumentsResult, RequiredDocument } from "@/lib/tools/check_documents";

const ORIGIN_TEXT: Record<RequiredDocument["origin"], string> = {
  COMMON: "어떤 경우에도 필요합니다",
  CHANNEL: "가입 경로 때문에 필요합니다",
  ISSUE: "이 쟁점이 문제될 때 필요합니다",
};

function DocGroup({
  title,
  docs,
  possessed,
  onToggle,
}: {
  title: string;
  docs: RequiredDocument[];
  possessed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <section className="mt-5">
      <h3 className="text-[1.05rem] font-bold text-fg">{title}</h3>
      <ul className="mt-2 space-y-3">
        {docs.map((d) => {
          const has = possessed.has(d.key);
          return (
            <li
              key={d.key}
              className={
                "rounded-md border px-4 py-4 " +
                (has ? "border-border bg-bg-subtle" : "border-border")
              }
            >
              {/* 라벨 전체가 탭 대상 — 체크박스만 노리게 하지 않는다 (A11Y-2) */}
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={has}
                  onChange={() => onToggle(d.key)}
                  className="mt-1 h-6 w-6 shrink-0 accent-accent"
                  aria-label={`${d.label} — 가지고 있어요`}
                />
                <span>
                  <span className={"font-bold " + (has ? "text-fg-muted" : "text-fg")}>
                    {d.label}
                    {has && <span className="ml-2 text-[0.95rem] font-bold text-fg-muted">보유</span>}
                  </span>
                  <span className="mt-1 block leading-relaxed text-fg-muted">{d.why}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DocumentChecklist({ result }: { result: CheckDocumentsResult }) {
  const [possessed, setPossessed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setPossessed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const by = (origin: RequiredDocument["origin"]) =>
    result.required.filter((d) => d.origin === origin);
  const missing = result.required.length - possessed.size;

  return (
    <div>
      {result.channelUnknown && (
        <p className="rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
          가입 경로를 고르지 않으셔서 <strong>경로별 자료는 빠져 있습니다.</strong> 경로를
          고르시면 그 경로에서 특히 중요한 자료를 함께 알려드립니다.
        </p>
      )}

      <p className="leading-relaxed text-fg-muted">
        이미 가지고 계신 자료에 표시해 보세요. 표시는 이 화면에만 남고 저장되지 않습니다.
      </p>

      <DocGroup title={ORIGIN_TEXT.COMMON} docs={by("COMMON")} possessed={possessed} onToggle={toggle} />
      <DocGroup title={ORIGIN_TEXT.CHANNEL} docs={by("CHANNEL")} possessed={possessed} onToggle={toggle} />
      <DocGroup title={ORIGIN_TEXT.ISSUE} docs={by("ISSUE")} possessed={possessed} onToggle={toggle} />

      {/* 결여 요약 — 남은 행동이 몇 개인지. 전부 모으면 그 사실을 말해준다 */}
      <p
        aria-live="polite"
        className={
          "mt-5 rounded-md px-4 py-3 leading-relaxed " +
          (missing === 0
            ? "border-l-4 border-border-strong bg-bg-subtle text-fg"
            : "border-l-4 border-warn-border bg-warn-bg text-warn-fg")
        }
      >
        {missing === 0 ? (
          <strong>필요한 자료를 전부 가지고 계신 것으로 표시하셨습니다.</strong>
        ) : (
          <>
            아직 없는 자료가 <strong>{missing}개</strong> 있습니다. 하나씩 확인해 모아 두세요.
          </>
        )}
      </p>
    </div>
  );
}
