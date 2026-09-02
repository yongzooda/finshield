"use client";

/**
 * 오류 신고 (F-404) — "이 판단이 사실과 다릅니다".
 *
 * 접수는 `/api/report`가 한다. **신고 본문도 마스킹을 거치고**, 지우지 못한
 * 개인정보가 의심되면 저장하지 않고 되돌아온다(EP-3). 화면은 그 응답을 그대로
 * 전한다 — "접수됐다"고 거짓으로 안심시키지 않는다.
 *
 * 판단 결과·세션과 연결하는 식별자는 보내지 않는다. 보내봐야 넣을 컬럼이
 * 없다(P-604).
 */

import { useState } from "react";

type State =
  | { name: "IDLE" }
  | { name: "SENDING" }
  | { name: "DONE"; id: string; maskedCount: number }
  | { name: "REJECTED"; message: string };

export function ReportForm() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ name: "IDLE" });

  const submit = async () => {
    setState({ name: "SENDING" });
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        id?: string;
        maskedCount?: number;
        ask?: string;
      };
      if (j.ok && j.id) {
        setState({ name: "DONE", id: j.id, maskedCount: j.maskedCount ?? 0 });
      } else {
        setState({ name: "REJECTED", message: j.ask ?? "지금은 접수하지 못했습니다." });
      }
    } catch {
      setState({ name: "REJECTED", message: "지금은 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  if (state.name === "DONE") {
    return (
      <div className="rounded-md border border-border px-4 py-4">
        <p className="font-bold text-fg">신고를 접수했습니다</p>
        <p className="mt-2 leading-relaxed text-fg-muted">
          접수번호 <code className="text-fg">{state.id.slice(0, 8)}</code> — 검토 후 정정한 내용은{" "}
          <a href="/verification#corrections" className="text-accent underline">
            검증 결과 화면
          </a>
          에 공개합니다.
          {state.maskedCount > 0 && ` 개인정보로 보이는 부분 ${state.maskedCount}건은 가리고 접수했습니다.`}
        </p>
      </div>
    );
  }

  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-4 py-4 text-[1.05rem] font-bold text-fg">
        이 판단이 사실과 다릅니다
      </summary>

      <div className="border-t border-border px-4 py-4">
        <p className="leading-relaxed text-fg-muted">
          어떤 점이 사실과 다른지 알려주시면 확인하고, 정정한 내용을 검증 결과 화면에
          공개합니다.
        </p>

        {state.name === "REJECTED" && (
          <p role="alert" className="mt-4 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3 leading-relaxed text-warn-fg">
            {state.message}
          </p>
        )}

        <label htmlFor="report" className="mt-4 block font-bold text-fg">
          사실과 다른 점
        </label>
        <textarea
          id="report"
          rows={5}
          value={text}
          disabled={state.name === "SENDING"}
          onChange={(e) => setText(e.target.value)}
          className="mt-2 block w-full rounded-lg border-2 border-border-strong px-4 py-3 leading-relaxed text-fg"
        />
        <p className="mt-2 leading-relaxed text-fg-muted">
          이름·연락처·계좌번호는 접수 전에 가려집니다. 확인에는 그런 정보가 필요하지 않습니다.
        </p>

        <button
          type="button"
          disabled={state.name === "SENDING" || text.trim().length === 0}
          onClick={submit}
          className="mt-4 flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg disabled:opacity-50"
        >
          {state.name === "SENDING" ? "보내는 중…" : "신고 보내기"}
        </button>
      </div>
    </details>
  );
}
