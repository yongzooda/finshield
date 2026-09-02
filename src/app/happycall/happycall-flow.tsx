"use client";

/**
 * S-14 해피콜 응답 연습 (SR-214) — 정적 분기 시나리오의 화면.
 *
 * 상태는 이 컴포넌트 안에만 있다 — 서버 전송·저장 없음 (P-3). 새로고침하면
 * 처음부터인데, 연습이므로 그것이 맞다.
 *
 * A11Y-4: 한 화면에 질문 하나. 답을 고르면 그 답의 해설이 같은 화면에
 * 열리고, 「다음」으로 넘어간다 — 해설을 읽는 것이 연습의 본체라서
 * 답과 동시에 다음 질문으로 건너뛰지 않는다.
 */

import { useState } from "react";
import Link from "next/link";
import type { HappycallAnswer, HappycallNode, HappycallScenario } from "@/lib/happycall";

type Picked = { node: HappycallNode; answer: HappycallAnswer };

/**
 * 시나리오가 여럿이면 먼저 고르게 한다 — 가입 경로에 따라 확인 전화의
 * 질문이 다르기 때문이다. 하나뿐이면 선택 없이 바로 그 시나리오다.
 */
export function HappycallChooser({ scenarios }: { scenarios: readonly HappycallScenario[] }) {
  const [chosen, setChosen] = useState<HappycallScenario | null>(
    scenarios.length === 1 ? scenarios[0] : null,
  );

  if (!chosen) {
    return (
      <div>
        <p className="leading-relaxed text-fg-muted">어떤 경로로 가입하셨나요? 경로에 따라 확인 전화의 질문이 다릅니다.</p>
        <div className="mt-5 space-y-3" role="group" aria-label="시나리오 선택">
          {scenarios.map((sc) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => setChosen(sc)}
              className="flex w-full min-h-12 items-center rounded-lg border-2 border-border px-5 py-3 text-left text-[1.05rem] font-bold text-fg"
            >
              {sc.title}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {scenarios.length > 1 && (
        <p className="mb-4">
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="inline-flex min-h-12 items-center text-[1.05rem] font-bold text-fg-muted underline underline-offset-2"
          >
            ← 다른 경로 고르기
          </button>
        </p>
      )}
      <HappycallFlow key={chosen.id} scenario={chosen} />
    </div>
  );
}

export function HappycallFlow({ scenario }: { scenario: HappycallScenario }) {
  const nodes = new Map(scenario.nodes.map((n) => [n.id, n]));
  const [phase, setPhase] = useState<"INTRO" | "ASK" | "DONE">("INTRO");
  const [currentId, setCurrentId] = useState(scenario.start);
  /** 이번 질문에서 고른 답 — 해설이 열린 상태 */
  const [picked, setPicked] = useState<HappycallAnswer | null>(null);
  /** 지나온 답변 — 마무리 recap용 */
  const [trail, setTrail] = useState<Picked[]>([]);

  const restart = () => {
    setPhase("INTRO");
    setCurrentId(scenario.start);
    setPicked(null);
    setTrail([]);
  };

  if (phase === "INTRO") {
    return (
      <div>
        {scenario.intro.map((p) => (
          <p key={p} className="mt-4 leading-relaxed text-fg first:mt-0">
            {p}
          </p>
        ))}
        <button
          type="button"
          onClick={() => setPhase("ASK")}
          className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg"
        >
          연습 시작하기
        </button>
      </div>
    );
  }

  if (phase === "DONE") {
    return (
      <div>
        <h2 className="text-[1.3rem] font-bold text-fg">이렇게 답하셨습니다</h2>
        <ol className="mt-4 space-y-3">
          {trail.map((t) => (
            <li key={t.node.id} className="rounded-md border border-border px-4 py-4">
              <p className="leading-relaxed text-fg-muted">{t.node.question}</p>
              <p className="mt-1 font-bold text-fg">→ {t.answer.label}</p>
            </li>
          ))}
        </ol>

        <h2 className="mt-10 text-[1.3rem] font-bold text-fg">기억해 두실 것</h2>
        <ul className="mt-4 space-y-3">
          {scenario.outro.map((p) => (
            <li key={p} className="rounded-md border-l-4 border-border-strong bg-bg-subtle px-4 py-4 leading-relaxed text-fg">
              {p}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap gap-3 print:hidden">
          <button
            type="button"
            onClick={restart}
            className="inline-flex min-h-12 items-center rounded-lg border-2 border-border px-7 py-3 text-[1.05rem] font-bold text-fg"
          >
            다른 답으로 다시 해보기
          </button>
          <Link
            href="/precheck"
            className="inline-flex min-h-12 items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg no-underline"
          >
            가입 전 확인으로
          </Link>
        </div>
      </div>
    );
  }

  const node = nodes.get(currentId);
  if (!node) return null; // validateScenario가 자료 단계에서 막는다 — 방어선일 뿐

  const step = trail.length + 1;
  const advance = () => {
    if (!picked) return;
    setTrail([...trail, { node, answer: picked }]);
    setPicked(null);
    if (picked.next === null) setPhase("DONE");
    else setCurrentId(picked.next);
  };

  return (
    <div>
      <p className="text-fg-muted">상담원 질문 {step}</p>
      <h2 className="mt-2 text-[1.3rem] font-bold leading-snug text-fg">“{node.question}”</h2>
      <p className="mt-3 leading-relaxed text-fg-muted">{node.why}</p>

      {/* 답을 고르면 해설이 열린다. 다시 고르면 해설이 바뀐다 — 비교해 봐도 된다 */}
      <div className="mt-6 space-y-3" role="group" aria-label="답변 선택">
        {node.answers.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => setPicked(a)}
            aria-pressed={picked === a}
            className={
              "flex w-full min-h-12 items-center rounded-lg border-2 px-5 py-3 text-left text-[1.05rem] font-bold " +
              (picked === a ? "border-accent bg-bg-subtle text-fg" : "border-border text-fg")
            }
          >
            {a.label}
          </button>
        ))}
      </div>

      {picked && (
        <div aria-live="polite">
          <p className="mt-5 rounded-md border-l-4 border-border-strong bg-bg-subtle px-4 py-4 leading-relaxed text-fg">
            {picked.meaning}
          </p>
          <button
            type="button"
            onClick={advance}
            className="mt-5 inline-flex min-h-12 items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg"
          >
            {picked.next === null ? "마무리 보기" : "다음 질문"}
          </button>
        </div>
      )}
    </div>
  );
}
