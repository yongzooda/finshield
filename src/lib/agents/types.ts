/**
 * 계층별 페이로드 타입 — **권한 매트릭스(P-4xx)의 구조적 구현체**.
 *
 * P-401: 「매트릭스의 ❌는 프롬프트 지시가 아니라 **호출 구조에서 강제**한다.
 * 판단 계층 호출 페이로드에 원문 필드 자체가 존재하지 않아야 한다.」
 *
 * 그래서 계층마다 **입력 타입을 따로 둔다.** 하나의 큰 컨텍스트 객체를 만들어
 * 계층마다 일부만 쓰는 방식이었다면, 원문을 넘기지 않는다는 보장이 규율에
 * 의존하게 된다. 여기서는 `JudgeInput`에 원문 필드가 **없어서** 넘길 수 없다.
 *
 *   데이터 ↓ / 계층 →      ① 상담   ② 조사   ③ 판단        ④ 안내
 *   사용자 진술 원문        읽기      ❌      ❌ 절대 불가    ❌
 *   확정 슬롯               쓰기      읽기     읽기           읽기
 *   정제 사실관계           생성      읽기     읽기           ❌
 *   도구 호출               ❌       호출     ❌             ❌
 *   수집 근거               ❌       생성     읽기           읽기(표시)
 *   판단 결과·확신도        ❌       ❌      생성           읽기(수정 불가)
 */

import type { Slots } from "../types";
import type { SimilarCase } from "../tools/search_case";
import type { LookupStatuteResult } from "../tools/lookup_statute";
import type { PrecedentHit } from "../tools/search_precedent";
import type { CheckDocumentsResult } from "../tools/check_documents";
import type { RiskPatternResult } from "../tools/analyze_risk_pattern";

/**
 * 정제 사실관계 — ① 상담이 만들고 ②③이 읽는다.
 *
 * 원문이 아니라 **구조화된 사실 진술**이다. 자유 문자열이 그대로 실려
 * 내려가면 원문 우회 통로가 되므로, 짧은 사실 문장의 목록으로 제한한다.
 */
export type RefinedFacts = {
  /** 사실 문장. 판단에 필요한 사실만 남긴 것이며 감정·추측·요구는 제외한다 */
  statements: string[];
  /** 확정 쟁점 태그 (issue_tags.code) */
  issues: string[];
  /** 상담 단계에서 끝내 확인하지 못한 항목 — 판단 결과에 함께 명시된다 (기획서 9.2) */
  unresolved: string[];
};

/** ② 조사가 수집한 근거. 전부 도구 반환값이며 모델이 만든 것이 아니다 (C-6) */
export type Evidence = {
  statutes: LookupStatuteResult[];
  /** 인용 가능(citable)으로 확인된 판례만 담는다 — 표시 불가 플래그가 붙은 건 제외 */
  precedents: PrecedentHit[];
  cases: SimilarCase[];
  documents: CheckDocumentsResult | null;
  riskPattern: RiskPatternResult | null;
  /** 도구가 실패해 비어 있는 근거 — 확신도에 반영되고 화면에 표시된다 (EP-1) */
  gaps: string[];
};

// ---------------------------------------------------------------- 계층별 입력

/** ① 상담 — 유일하게 원문을 본다. 이미 PII 마스킹을 거친 상태여야 한다 (F-601) */
export type ConsultInput = {
  /** 마스킹된 사용자 진술. 원문이 이 계층 밖으로 나가지 않는다 */
  maskedStatement: string;
  /** 지금까지 확정된 슬롯 (되묻기 누적) */
  slots: Partial<Slots>;
  /** 이번 사이클에서 이미 물어본 횟수 — 상한 판정용 */
  askedCount: number;
  /**
   * 유보 이어가기 (F-308 확장 · R-07 ①). 직전 판단이 유보였을 때 재진입 상담이
   * 받는 맥락 — «필요 자료» 목록과 이전에 정제해 둔 사실관계. **판단 결론·확신도·
   * 이유는 이 타입에 들어오지 않는다** — ① 상담이 판단 결과를 보지 못한다는
   * 격리(권한 매트릭스)를 타입으로 지킨다. needed는 이미 화면으로 이용자에게
   * 안내된 문장들이다.
   */
  reentry?: {
    needed: readonly string[];
    priorFacts: RefinedFacts;
  } | null;
};

/** ② 조사 — 슬롯과 정제 사실관계만 받는다. 원문 필드가 없다 */
export type InvestigateInput = {
  slots: Slots;
  facts: RefinedFacts;
  /** 기준일 (YYYY-MM-DD). `contract_ym`에서 산정해 넘긴다 */
  basisDate: string | null;
};

/**
 * ③ 판단 — **원문 필드가 없다. 이것이 SR-402의 구현이다.**
 *
 * 이 타입에 진술·원문 계열 필드를 추가하는 순간 편향 차단 경계가 깨진다.
 * 추가가 필요해 보이면 그건 타입 문제가 아니라 설계 문제이며,
 * ③이 더 알아야 한다면 직접 조회가 아니라 **되돌림(F-308·P-402)**으로 요청한다.
 */
export type JudgeInput = {
  slots: Slots;
  facts: RefinedFacts;
  evidence: Evidence;
};

/** ④ 안내 — 판단 결과를 읽되 **수정하지 않는다**. 표현 변환만 한다 */
export type GuideInput = {
  slots: Slots;
  evidence: Evidence;
  judgment: Readonly<Judgment>;
};

// ---------------------------------------------------------------- 판단 결과

export type Conclusion = "LIKELY" | "UNLIKELY";

/** ③ 판단의 산출물. ④는 이 객체를 읽기만 한다 */
export type Judgment = {
  conclusion: Conclusion;
  /** 프롬프트 자기평가 1~5 정수. 로그확률이 아니다 (U-1 · 기획서 6.1) */
  confidence: 1 | 2 | 3 | 4 | 5;
  /** 판단이 선 쟁점 */
  issues: string[];
  /** 결론에 이른 이유. 근거 인용은 evidence를 가리키며 여기서 만들지 않는다 */
  reasoning: string;
  /** 판단이 달라질 수 있는 조건 (F-306 ④) */
  changesIf: string[];
};

/** 확신도 임계 분기 결과 (F-305 · SR-403) */
export type JudgmentOutcome =
  | { kind: "CONCLUDED"; judgment: Judgment }
  | {
      kind: "WITHHELD";
      /** 유보 사유. 실패가 아니라 안전한 종착이다 (EP-2) */
      reason: "LOW_CONFIDENCE" | "INSUFFICIENT_EVIDENCE" | "TOOL_BUDGET" | "FORMAT_ERROR";
      /** 어떤 자료가 있으면 판단 가능한지 (F-307) */
      needed: string[];
      /** 유보라도 확신도는 로그에 남는다 — 임계 재보정 자료 */
      confidence: number | null;
    };

/**
 * ③ 판단 입력에 원문 계열 필드가 섞이지 않았는지 컴파일 시점에 확인한다.
 * 아래 줄이 타입 에러를 내면 `JudgeInput`에 금지 필드가 추가된 것이다.
 */
type ForbiddenInJudge = "maskedStatement" | "rawStatement" | "statement" | "userText" | "transcript";
type _AssertNoRawInJudge = Extract<keyof JudgeInput, ForbiddenInJudge> extends never
  ? true
  : ["SR-402 위반: 판단 계층 입력에 원문 필드가 있다", Extract<keyof JudgeInput, ForbiddenInJudge>];
export const _judgeInputIsIsolated: _AssertNoRawInJudge = true;
