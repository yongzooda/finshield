/**
 * 실행 로그 (F-402 · S-08 흡수) — **접이식, 기본 접힘, 항목 축약 없이**.
 *
 * "AI가 판단했습니다"로 끝내지 않기 위한 화면이다(화면 명세 S-08 목적). 무엇을
 * 언제 조회했고 무엇이 실패했는지를 이용자가 직접 볼 수 있어야 한다.
 *
 * ⚠️ **명세는 표현까지 정해 놓았다** — 「기술 로그 원문이 아니라 일반 사용자가
 * 읽을 수 있는 문장으로. 도구 원어명은 보조 표기」(S-08 표현). 예전 구현은
 * `detail` 객체를 `키 값 · 키 값`으로 덤프해서 화면에
 * `tool lookup_statute · outcome OK · law … · source SNAPSHOT · fallback false`가
 * 그대로 나갔다. 실기(2026.08.24, 카카오톡 인앱)에서 「코드 같아서 이해가
 * 안 된다」는 지적을 받았고, 명세 위반이기도 했다.
 *
 * **줄이지 않고 옮긴다.** 모르는 키는 감추지 않고 원래 이름 그대로 내보낸다 —
 * 「실패는 표시한다」(EP-1)를 지키려면 새 키가 조용히 사라지면 안 된다.
 * 도구 원어명은 작은 글씨로 함께 둔다.
 *
 * `detail`에는 도구명·건수 같은 것만 들어 있고 진술·슬롯 값·판단 본문은 애초에
 * 담기지 않는다 (N-403).
 */

import type { TraceEntry, TraceLayer } from "@/lib/agents/trace";

const LAYER_LABEL: Record<TraceLayer, string> = {
  CONSULT: "상담",
  INVESTIGATE: "조사",
  JUDGE: "판단",
  GUIDE: "안내",
  SYSTEM: "진행",
};

/** `detail` 키의 한국어 이름. 없는 키는 원래 이름을 그대로 쓴다 */
const KEY_LABEL: Record<string, string> = {
  // lookup_statute
  law: "법령",
  article: "조문",
  source: "출처",
  fallback: "보관본 사용",
  // search_precedent
  rank: "후보 중 순번",
  total: "후보 수",
  retried: "쟁점 바꿔 재시도",
  // 인젝션 필터 (F-606) — 외부 자료 속 지시문 형태 문장을 무해화 표기로 감싼 수
  sanitized: "무해화한 지시문",
  // search_case
  matched: "조건에 맞는 사례",
  returned: "가져온 사례",
  filters: "적용한 조건",
  widened: "기준을 넓힌 단계",
  // check_documents
  required: "필요 자료",
  clauses: "관련 약관 조항",
  channelUnknown: "가입 경로 미상",
  // analyze_risk_pattern
  granularity: "집계 단위",
  fellBack: "범위를 넓혀 재집계",
  issues: "쟁점 수",
  // 조사 마무리 · 상한
  statutes: "법령",
  precedents: "판례",
  cases: "사례",
  gaps: "확보하지 못한 근거",
  scope: "상한 종류",
  used: "사용",
  limit: "상한",
  // judge · guide
  confidence: "확신도",
  threshold: "기준",
  removed: "제거한 문장",
  // 공통
  reason: "사유",
};

/** 코드로 적힌 값의 한국어 표기. 없는 값은 그대로 쓴다 */
const VALUE_LABEL: Record<string, string> = {
  SNAPSHOT: "보관된 옛 조문",
  API: "법제처 현행 조문",
  NO_BASIS_DATE: "가입 시점을 몰라서",
  NO_ROWS: "집계된 자료가 없어서",
  UNKNOWN_TOOL: "없는 도구를 불러서",
  CYCLE: "이번 판단",
  SESSION: "이번 상담 전체",
  PRODUCT: "상품군",
  PRODUCT_CHANNEL: "상품군과 가입 경로",
  OVERALL: "전체",
};

function valueText(v: string | number | boolean | null): string {
  if (v === null) return "없음";
  if (typeof v === "boolean") return v ? "예" : "아니요";
  if (typeof v === "number") return String(v);
  return VALUE_LABEL[v] ?? v;
}

/**
 * `detail`을 읽을 수 있는 줄로 바꾼다.
 *
 * `tool`·`outcome`은 빼고 따로 표기한다 — 무엇을 했는지는 이미 문장에 있고,
 * 도구 원어명은 보조 표기 자리로 간다.
 */
function detailLine(detail: TraceEntry["detail"]): string | null {
  if (!detail) return null;
  const parts = Object.entries(detail)
    .filter(([k]) => k !== "tool" && k !== "outcome")
    .map(([k, v]) => `${KEY_LABEL[k] ?? k} ${valueText(v)}`);
  return parts.length ? parts.join(" · ") : null;
}

/** 도구 원어명 — 「보조 표기」(S-08). 검증하려는 사람에게는 이 이름이 필요하다 */
function toolName(detail: TraceEntry["detail"]): string | null {
  const t = detail?.tool;
  return typeof t === "string" ? t : null;
}

/**
 * 4계층과 편향 차단 경계를 한 줄로 보인다 (SR-402).
 *
 * 판단 계층이 원문을 받지 않는다는 사실은 타입과 테스트가 강제하지만, 지금까지
 * 화면 어디에도 드러나지 않았다. 실행 로그 위에 구조를 먼저 보여 아래 로그의
 * `[상담]…[판단]` 라벨이 무엇인지 읽히게 한다. 정적 마크업이라 환각 여지가 없다.
 */
function PipelineStrip() {
  const chip = "rounded-md border border-border px-3 py-1.5 font-bold text-fg";
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
        <span className={chip}>① 상담</span>
        <span className="text-fg-muted">→</span>
        <span className={chip}>② 조사</span>
        <span className="text-fg-muted">→</span>
        <span className="rounded-md border-2 border-navy bg-bg-subtle px-3 py-1.5 font-bold text-navy">
          ⊘ 원문 차단
        </span>
        <span className="text-fg-muted">→</span>
        <span className={chip}>③ 판단</span>
        <span className="text-fg-muted">→</span>
        <span className={chip}>④ 안내</span>
      </div>
      <p className="mt-2 leading-relaxed text-fg-muted">
        판단 단계는 말씀하신 원문이 아니라 <strong className="text-fg">상담이 정제한
        사실관계와 조사가 확보한 근거만</strong> 전달받습니다. 호소나 감정이 판단을
        기울이지 않게 하기 위한 구조입니다.
      </p>
    </div>
  );
}

export function ExecutionLog({ entries }: { entries: readonly TraceEntry[] }) {
  return (
    <>
    <PipelineStrip />
    <details className="group rounded-md border border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 py-4 text-[1.05rem] font-bold text-fg">
        <span
          aria-hidden="true"
          className="mr-2 inline-block shrink-0 text-fg-muted transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        어떻게 이 결과가 나왔는지 보기 ({entries.length}단계)
      </summary>

      <div className="border-t border-border px-4 py-4">
        <p className="leading-relaxed text-fg-muted">
          아래는 실제로 거친 과정입니다. 조회에 실패했거나 대조하지 못한 것도 그대로
          적혀 있습니다.
        </p>

        <ol className="mt-4 space-y-3">
          {entries.map((e) => {
            const line = detailLine(e.detail);
            const tool = toolName(e.detail);
            return (
              <li
                key={e.seq}
                className={
                  "rounded-md px-4 py-3 leading-relaxed " +
                  (e.level === "WARN"
                    ? "border-l-4 border-warn-border bg-warn-bg text-warn-fg"
                    : "border border-border text-fg")
                }
              >
                <p>
                  <span className="font-bold">
                    {e.level === "WARN" ? "⚠ " : ""}
                    [{LAYER_LABEL[e.layer]}]
                  </span>{" "}
                  {e.message}
                </p>

                {line && <p className="mt-1 leading-relaxed text-fg-muted">{line}</p>}

                <p className="mt-1 text-[0.95rem] text-fg-muted">
                  {(e.atMs / 1000).toFixed(1)}초 경과
                  {tool && ` · 도구 ${tool}`}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
    </>
  );
}
