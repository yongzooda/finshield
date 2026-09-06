"use client";

/**
 * 판단 스트림 소비 — `/api/judge`가 흘리는 NDJSON을 줄 단위로 읽는다.
 *
 * 무단계 스피너를 두지 않는다 (화면 4.3). 지금 무슨 자료를 보고 있는지 문장으로
 * 보여주고, 오래 걸리는 구간에서는 경과 시간을 함께 보여 준다 — 멈춘 것이
 * 아니라는 신호가 없으면 이용자는 창을 닫는다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { dropSession, takeEntry, takeSession } from "../consult/session-store";
import { JudgmentResult } from "./judgment-result";
import type { JudgmentDone } from "./types";
import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";

type Step = { stage: string; message: string };

/**
 * 진행 중에 흘러오는 실행 로그 한 줄.
 *
 * 조사 구간은 도구를 8~10회 부르며 50초 넘게 도는데, 예전에는 그동안 단계 문장
 * 하나만 띄우고 침묵했다 — **가장 일을 많이 하는 구간이 가장 조용했다.**
 * 여기 쌓이는 것은 `done`의 실행 로그와 같은 항목이며, 도착 시점만 앞당긴 것이다.
 */
type Trail = { seq: number; message: string; note: string | null; warn: boolean };

/**
 * 무엇에 대한 조회였는지 한 조각만 덧붙인다.
 *
 * 「법령 조문을 찾았습니다」가 네 번 연달아 뜨면 무엇을 찾았는지 알 수 없다.
 * 조문 번호 하나만 붙어도 **네 줄이 서로 다른 일**이 된다. 실행 로그(S-08)는
 * 결과 화면에서 전부 보여주므로, 여기서는 알아볼 만큼만 고른다.
 */
function trailNote(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);

  const law = s("law");
  if (law) return [law, s("article")].filter(Boolean).join(" ");
  if (n("returned") !== null) return `사례 ${n("returned")}건`;
  if (n("total") !== null) return `후보 ${n("total")}건`;
  if (n("required") !== null) return `자료 ${n("required")}가지`;
  if (n("issues") !== null) return `쟁점 ${n("issues")}가지`;
  if (n("statutes") !== null) return `법령 ${n("statutes")} · 사례 ${n("cases") ?? 0}`;
  return null;
}

type Stopped = {
  name: "STOPPED";
  title: string;
  message: string;
  retry: boolean;
  /** 기본은 「다시 시도하기」. 새로고침 진입처럼 실패가 아닌 경우에는 문구를 바꾼다 */
  retryLabel?: string;
};

type View =
  /** 마운트 직후 — 진입 경로를 아직 보지 않았다. 화면에는 나오지 않는다 */
  | { name: "IDLE" }
  | { name: "RUNNING"; steps: Step[]; trail: Trail[]; elapsedMs: number }
  | { name: "DONE"; done: JudgmentDone }
  | Stopped;

const NO_SESSION: Stopped = {
  name: "STOPPED",
  title: "이어서 볼 상담이 없습니다",
  message:
    "상담을 먼저 진행해 주세요. 프리케이스는 개인정보를 저장하지 않아 이전 상담을 " +
    "다시 불러올 수 없습니다.",
  retry: false,
};

/**
 * 새로고침·주소 직접 진입 (T-5 · EX-403).
 *
 * **판단 결과는 저장하지 않으므로 앞서 본 결과는 남지 않는다.** 그것은 설계
 * 동작이라 오류처럼 보이면 안 된다. 다만 봉인 세션은 살아 있어서 다시 살펴볼
 * 수는 있다 — 상담을 처음부터 시킬 이유가 없다.
 *
 * **자동으로 다시 돌리지 않는다.** 판단은 90초와 모델 호출을 쓰고 일일 상한
 * (N-203)을 깎는다. 아무 설명 없이 그것을 태우면, 결과를 읽다 새로고침한
 * 사람은 왜 처음 화면으로 돌아갔는지 알 수 없다.
 */
const RELOADED: Stopped = {
  name: "STOPPED",
  title: "결과는 저장하지 않습니다",
  // 「앞서 보신 결과」라고 쓰지 않는다 — 판단 도중에 화면이 다시 열리면
  // 이용자는 결과를 본 적이 없다. 인앱 브라우저가 메모리를 회수하면 실제로
  // 일어나는 경우라, 둘 다에 맞는 말이어야 한다 (N-701)
  message:
    "이 화면을 새로 열면 판단 결과가 남지 않습니다. 프리케이스가 결과를 저장하지 " +
    "않기 때문입니다. 말씀해 주신 내용은 아직 남아 있어 지금 다시 살펴볼 수 " +
    "있습니다. 2분 정도 걸립니다.",
  retry: true,
  retryLabel: "다시 살펴보기",
};

/**
 * 판단을 시작하지 못한 응답을 화면 상태로 옮긴다.
 *
 * **세션을 버릴지가 갈림길이다.** 410(만료·위조)은 세션이 실제로 사라진
 * 것이라 다시 시도해도 같은 답이 온다. 그러나 429(레이트 리밋)·503(예산
 * 소진)·5xx는 **세션이 멀쩡한데 지금 못 받을 뿐**이다. 여기서 세션을 버리면
 * 잠시 뒤 될 일에 상담을 처음부터 다시 시키게 된다.
 *
 * 순수 함수로 빼 둔 이유는 이 분기를 테스트로 고정하기 위해서다.
 */
export function stopForStatus(status: number, message: string | null): {
  view: Stopped;
  keepSession: boolean;
} {
  if (status === 410) {
    return {
      keepSession: false,
      view: {
        name: "STOPPED",
        title: "상담 내용이 사라졌습니다",
        message: message ?? "처음부터 다시 진행해 주세요.",
        retry: false,
      },
    };
  }

  return {
    keepSession: true,
    view: {
      name: "STOPPED",
      title: "지금은 살펴보지 못했습니다",
      message:
        message ??
        "판단을 시작하지 못했습니다. 저희 쪽 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.",
      retry: true,
    },
  };
}

export function JudgmentProgress({
  /** 절차 안내 조문 — 서버(page.tsx)가 조회해 넘긴다. S-04까지 그대로 통과한다 */
  procedureStatutes = [],
}: {
  procedureStatutes?: readonly LookupStatuteResult[];
}) {
  // 첫 렌더는 「시작 전」이다 — 자동으로 돌릴지는 마운트 때 진입 경로를 보고 정한다 (T-5)
  const [view, setView] = useState<View>({ name: "IDLE" });
  const started = useRef(false);
  /** 판단 한 번이 가장 비싼 호출이다 — 겹쳐 도는 일이 없게 막는다 (EX-404) */
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;

    const session = takeSession();
    if (!session) {
      setView(NO_SESSION);
      return;
    }


    // 다시 시도로 들어올 수 있다 — 이전 중단 화면을 지우고 처음부터 다시 센다
    inFlight.current = true;
    setView({ name: "RUNNING", steps: [], trail: [], elapsedMs: 0 });

    const t0 = Date.now();
    const tick = setInterval(
      () => setView((v) => (v.name === "RUNNING" ? { ...v, elapsedMs: Date.now() - t0 } : v)),
      1000,
    );

    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
      });

      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        const stop = stopForStatus(res.status, j?.message ?? null);
        if (!stop.keepSession) dropSession();
        setView(stop.view);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const steps: Step[] = [];

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 줄 단위 JSON — 마지막 조각은 다음 청크와 이어붙인다
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as Record<string, unknown>;

          if (ev.type === "stage") {
            steps.push({ stage: String(ev.stage), message: String(ev.message) });
            setView((v) =>
              v.name === "RUNNING"
                ? { ...v, steps: [...steps], elapsedMs: Date.now() - t0 }
                : { name: "RUNNING", steps: [...steps], trail: [], elapsedMs: Date.now() - t0 },
            );
          } else if (ev.type === "step") {
            // 무엇을 조회하고 있는지 그대로 쌓는다. 실패도 숨기지 않는다 (EP-1)
            const line: Trail = {
              seq: Number(ev.seq),
              message: String(ev.message),
              note: trailNote(ev.detail),
              warn: ev.level === "WARN",
            };
            setView((v) =>
              v.name === "RUNNING"
                ? { ...v, trail: [...v.trail, line], elapsedMs: Date.now() - t0 }
                : v,
            );
          } else if (ev.type === "done") {
            setView({ name: "DONE", done: ev as unknown as JudgmentDone });
          } else if (ev.type === "error") {
            // 슬롯이 덜 찬 세션은 다시 불러도 같은 답이 온다 — 상담으로 돌아가야 한다
            setView({
              name: "STOPPED",
              title: "판단을 끝내지 못했습니다",
              message: String(ev.message ?? "잠시 후 다시 시도해 주세요."),
              retry: ev.code !== "SLOTS_INCOMPLETE",
            });
          }
          // heartbeat는 화면에 쓰지 않는다 — 연결 유지가 목적이다
        }
      }
    } catch {
      // 인앱 브라우저에서 흔한 경로다 — 앱을 잠시 나갔다 오면 연결이 끊긴다.
      // **세션을 버리지 않는다.** 봉인 토큰이 그대로 있어 다시 시도하면 이어진다
      setView({
        name: "STOPPED",
        title: "연결이 끊겼습니다",
        message:
          "살펴보는 도중 다른 앱을 보시면 연결이 끊길 수 있습니다. " +
          "말씀해 주신 내용은 아직 남아 있습니다. 아래에서 다시 시도해 주세요.",
        retry: true,
      });
    } finally {
      clearInterval(tick);
      inFlight.current = false;
    }
  }, []);

  /**
   * 진입 경로를 보고 자동 실행 여부를 정한다.
   *
   * 서버 렌더에서는 판정할 수 없다 — `sessionStorage`도 모듈 상태도 브라우저에만
   * 있다. 그래서 첫 렌더는 `IDLE`로 두고 마운트 뒤에 정한다.
   */
  const begin = useCallback(() => {
    const entry = takeEntry();
    if (entry.kind === "NONE") {
      setView(NO_SESSION);
      return;
    }
    // 상담에서 넘어온 진입만 자동으로 돌린다. 새로고침·직접 진입은 물어본다 (T-5)
    if (entry.kind === "HANDOFF") void run();
    else setView(RELOADED);
  }, [run]);

  useEffect(() => {
    // 개발 모드의 이중 마운트에서 파이프라인이 두 번 도는 것을 막는다 — 모델 비용이다
    if (started.current) return;
    started.current = true;
    begin();
  }, [begin]);

  // 결과가 오면 곧바로 S-04로 전이한다 (T-1). 중간 확인 단계를 두지 않는다
  if (view.name === "DONE")
    return <JudgmentResult done={view.done} procedureStatutes={procedureStatutes} />;
  if (view.name === "IDLE") return null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      {view.name === "STOPPED" ? (
        <StoppedView view={view} onRetry={run} />
      ) : (
        <Running view={view} />
      )}
    </div>
  );
}

function Running({ view }: { view: Extract<View, { name: "RUNNING" }> }) {
  const secs = Math.round(view.elapsedMs / 1000);

  return (
    <>
      <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
        자료를 살펴보고 있습니다
      </h1>
      {/* 소요 시간은 직전 화면(상담 완료·재개 안내)이 이미 말했다 — 같은 말을 연달아 하지 않는다 */}
      <p className="mt-3 leading-relaxed text-fg-muted">
        관련 법령과 비슷한 분쟁조정 사례를 하나씩 확인합니다.
      </p>

      <ol aria-live="polite" className="mt-8 space-y-3">
        {view.steps.map((s, i) => (
          <li key={s.stage} className="rounded-md border border-border px-4 py-4 leading-relaxed">
            <span className="font-bold text-fg">{s.message}</span>
            {i === view.steps.length - 1 && <span className="ml-2 text-fg-muted">진행 중…</span>}
          </li>
        ))}
      </ol>

      {/*
        지금 무엇을 조회하고 있는지 한 줄씩 쌓는다.
        조사 구간은 50초 넘게 도는데 예전에는 그동안 아무것도 바뀌지 않아
        멈춘 것처럼 보였다. 실패도 그대로 보인다 (EP-1).
        `aria-live="polite"`는 위 단계 목록이 이미 갖고 있으므로 여기서는 쓰지 않는다
        — 도구 호출마다 스크린리더가 읽으면 소음이 된다.
      */}
      {view.trail.length > 0 && (
        <ul className="mt-4 space-y-2">
          {view.trail.map((t) => (
            <li
              key={t.seq}
              className={
                "flex gap-2 leading-relaxed " + (t.warn ? "text-warn-fg" : "text-fg-muted")
              }
            >
              <span aria-hidden="true">{t.warn ? "⚠" : "·"}</span>
              <span>
                {t.message}
                {t.note && <span className="text-fg-muted"> — {t.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-fg-muted" aria-live="polite">
        {secs}초 경과 — 창을 닫지 마세요. 닫으면 처음부터 다시 하셔야 합니다.
      </p>
    </>
  );
}

function StoppedView({ view, onRetry }: { view: Stopped; onRetry: () => void }) {
  const { title, message, retry, retryLabel } = view;
  return (
    <>
      <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">{title}</h1>
      <p className="mt-3 leading-relaxed">{message}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {/* 상담을 통째로 다시 하게 만들지 않는다 — 봉인 세션이 남아 있으면 여기서 이어진다 */}
        {retry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg"
          >
            {retryLabel ?? "다시 시도하기"}
          </button>
        )}
        {/* 다시 시도가 있으면 그쪽이 주 행동이다 — 강조를 둘로 나누지 않는다 */}
        <Link
          href="/consult"
          className={
            "flex items-center rounded-lg px-7 py-3 text-[1.05rem] font-bold no-underline " +
            (retry
              ? "border-2 border-border text-fg"
              : "bg-accent text-accent-fg")
          }
        >
          상담 다시 시작하기
        </Link>
        {/* 가입 뒤 축의 첫 화면은 /precase 다. 루트는 FinShield 첫 화면이다. */}
        <Link
          href="/precase"
          className="flex items-center rounded-lg border-2 border-border px-7 py-3 text-[1.05rem] font-bold text-fg no-underline"
        >
          처음으로
        </Link>
      </div>
    </>
  );
}
