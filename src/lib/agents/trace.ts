/**
 * F-402 실행 로그 — 슬롯 확정 → 도구 호출 → 판단 → 변환 전 과정을 기록한다.
 *
 * 규칙 두 가지가 구조를 결정한다:
 *
 *  1. **추가(append)만 가능하다.** 어느 계층도 기록을 수정·삭제할 수 없다
 *     (P-4xx 실행 로그 규칙). 그래서 배열을 외부에 노출하지 않고 복사본만 준다.
 *  2. **서버에 저장하지 않는다** (DR-404). 세션 메모리에만 존재하며 세션이
 *     끝나면 사라진다. 이 모듈이 DB를 import하지 않는 것이 그 보장이다.
 *
 * 대조 실패·표시 보류·유보 사유도 전부 남긴다 — 「로그가 없는 예외처리는
 * 없는 것과 같다」(EP-6).
 */

export type TraceLayer = "CONSULT" | "INVESTIGATE" | "JUDGE" | "GUIDE" | "SYSTEM";

export type TraceLevel = "INFO" | "WARN";

export type TraceEntry = {
  seq: number;
  /** 세션 시작으로부터 경과 ms — 절대 시각을 남기지 않는다(재식별 여지 축소) */
  atMs: number;
  layer: TraceLayer;
  level: TraceLevel;
  /** 무슨 일이 있었는지. 화면에 그대로 보인다 */
  message: string;
  /**
   * 구조화 상세. **진술·슬롯 값·판단 본문을 넣지 않는다** (N-403).
   * 도구명·건수·소요시간·상태처럼 내용이 아닌 것만 담는다.
   */
  detail?: Record<string, string | number | boolean | null>;
};

export type ToolOutcome = "OK" | "EMPTY" | "FAILED" | "BLOCKED";

/**
 * 도구 호출 한 건을 **사람이 읽는 문장**으로 적는다 (화면 명세 S-08 표현 규칙).
 *
 * 예전에는 `도구 호출 lookup_statute — OK`처럼 기술 로그 원문을 그대로 남겼다.
 * 실기(2026.08.24, 카카오톡 인앱)에서 이용자가 「코드 같아서 이해가 안 된다」고
 * 지적했고, 명세는 처음부터 **「기술 로그 원문이 아니라 일반 사용자가 읽을 수
 * 있는 문장으로. 도구 원어명은 보조 표기」** 를 요구하고 있었다.
 *
 * 도구 원어명은 `detail.tool`에 그대로 남으므로 **정보가 줄지 않는다** — 화면이
 * 작은 글씨로 함께 보여준다.
 */
export function toolMessage(tool: string, outcome: ToolOutcome): string {
  const done = TOOL_MESSAGES[tool];
  if (done) return done[outcome];
  // 모르는 도구 — 이름을 지어내지 않고 그대로 적는다
  return outcome === "OK" || outcome === "EMPTY"
    ? `${tool} 조회를 마쳤습니다`
    : `${tool} 조회를 하지 못했습니다`;
}

const TOOL_MESSAGES: Record<string, Record<ToolOutcome, string>> = {
  lookup_statute: {
    OK: "법령 조문을 찾았습니다",
    EMPTY: "법령 조문을 찾지 못했습니다",
    FAILED: "법령 조회 중 문제가 생겼습니다",
    BLOCKED: "이 법령은 조회하지 않았습니다",
  },
  search_precedent: {
    OK: "판례를 찾아 사건번호가 맞는지 대조했습니다",
    EMPTY: "사건번호가 맞는 판례가 없어 판례는 쓰지 않았습니다",
    FAILED: "판례 조회 중 문제가 생겼습니다",
    BLOCKED: "판례를 조회하지 않았습니다",
  },
  search_case: {
    OK: "비슷한 분쟁조정 사례를 찾았습니다",
    EMPTY: "비슷한 분쟁조정 사례를 찾지 못했습니다",
    FAILED: "분쟁조정 사례 조회 중 문제가 생겼습니다",
    BLOCKED: "분쟁조정 사례를 조회하지 않았습니다",
  },
  check_documents: {
    OK: "준비하실 자료를 정리했습니다",
    EMPTY: "준비하실 자료를 찾지 못했습니다",
    FAILED: "자료 목록 조회 중 문제가 생겼습니다",
    BLOCKED: "자료 목록을 조회하지 않았습니다",
  },
  analyze_risk_pattern: {
    OK: "이 조건에서 분쟁이 잦은 쟁점을 확인했습니다",
    EMPTY: "이 조건의 집계 자료가 없었습니다",
    FAILED: "집계 조회 중 문제가 생겼습니다",
    BLOCKED: "집계를 조회하지 않았습니다",
  },
};

export class Trace {
  private entries: TraceEntry[] = [];
  private seq = 0;
  private startedAt = Date.now();

  /**
   * 봉인된 로그에서 되살린다 (seal.ts). 상담 구간에서 쌓인 기록이 판단 구간으로
   * 이어져야 실행 로그(F-402)가 「슬롯 확정 → 도구 호출 → 판단」 전 과정을 담는다.
   */
  static restore(entries: readonly TraceEntry[]): Trace {
    const t = new Trace();
    t.entries = entries.map((e) => ({ ...e }));
    t.seq = entries.reduce((m, e) => Math.max(m, e.seq), 0);
    // 경과 시간이 이어지도록 시작 시각을 뒤로 민다
    const last = entries.length ? entries[entries.length - 1].atMs : 0;
    t.startedAt = Date.now() - last;
    return t;
  }

  private push(layer: TraceLayer, level: TraceLevel, message: string, detail?: TraceEntry["detail"]) {
    this.entries.push({
      seq: ++this.seq,
      atMs: Date.now() - this.startedAt,
      layer,
      level,
      message,
      detail,
    });
  }

  info(layer: TraceLayer, message: string, detail?: TraceEntry["detail"]): void {
    this.push(layer, "INFO", message, detail);
  }

  /** 화면에 ⚠로 표기되는 항목 — 대조 실패·폴백·표시 보류 (EP-1) */
  warn(layer: TraceLayer, message: string, detail?: TraceEntry["detail"]): void {
    this.push(layer, "WARN", message, detail);
  }

  /** 도구 호출 1건 기록. 인자 값이 아니라 **어떤 필터를 걸었는지**만 남긴다 */
  toolCall(
    tool: string,
    outcome: ToolOutcome,
    detail?: TraceEntry["detail"],
  ): void {
    const level = outcome === "OK" || outcome === "EMPTY" ? "INFO" : "WARN";
    this.push("INVESTIGATE", level, toolMessage(tool, outcome), { tool, outcome, ...detail });
  }

  /** 읽기 전용 복사본. 원본 배열을 넘기면 외부에서 수정·삭제할 수 있다 */
  read(): readonly TraceEntry[] {
    return this.entries.map((e) => ({ ...e, detail: e.detail ? { ...e.detail } : undefined }));
  }

  get size(): number {
    return this.entries.length;
  }

  /** 화면 표시용 요약 — 경고가 몇 건인지가 신뢰의 단서가 된다 */
  summary(): { total: number; warnings: number; tools: number } {
    return {
      total: this.entries.length,
      warnings: this.entries.filter((e) => e.level === "WARN").length,
      tools: this.entries.filter((e) => e.detail?.tool !== undefined).length,
    };
  }
}
