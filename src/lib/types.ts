/**
 * 공통 열거·슬롯 타입 — 코드 쪽 단일 출처.
 *
 * 값의 정본은 DB CHECK 제약이다 (supabase/migrations, 0003이 최신).
 * 이 파일이 DB와 어긋나면 `npm test`의 enums-db 대조 테스트가 실패한다 —
 * 문서(10-db.md)가 마이그레이션보다 낡아 게이트가 오작동한 사고의 재발 방지 장치다.
 *
 * DB 열거와 슬롯 열거를 구분한다 (D-2):
 *   - DB에는 UNKNOWN/NONE을 저장하지 않는다 (NULL·행 부재로 표현)
 *   - 세션 슬롯에는 UNKNOWN/NONE이 존재한다 (되묻기·유보 판정에 쓰인다)
 *
 * 열거 변경 시 기능 명세 2장 · 데이터 명세 3장 · DB 명세서 · 마이그레이션을
 * 동시 갱신한다 (N-801).
 */

import { z } from "zod";

// ---------------------------------------------------------------- DB 열거 (CHECK 제약 1:1)

/** 업권 5종 — 마이그레이션 0003: ETC 제거, CARD·UNKNOWN 추가 */
export const SECTORS = ["INSURANCE", "INVESTMENT", "BANKING", "CARD", "UNKNOWN"] as const;

/** 판매채널 5종 — DB는 미식별을 NULL로 저장 (UNKNOWN 값 없음) */
export const DB_CHANNELS = ["TM", "BANCA_HS", "AGENT", "BRANCH", "ONLINE"] as const;

/** 상품군 13종 — 기능 명세 2.3 업권 2단 구조 */
export const PRODUCT_CODES = [
  "INS_SILSON", "INS_WHOLE", "INS_ANNUITY", "INS_SAVINGS", "INS_AUTO", "INS_ETC",
  "INV_ELS", "INV_FUND", "INV_MARGIN", "INV_ETC",
  "BNK_LOAN", "BNK_ETC",
  "ETC_UNKNOWN",
] as const;

/** 소비자 특성 4종 — DB는 NONE을 행 부재로 표현 */
export const DB_TRAITS = ["PRO", "ELDER", "INEXP", "CAPACITY"] as const;

/** 결론 2치 — 마이그레이션 0003: PARTIAL 실측 0건으로 제거. 채점 매핑: 높음↔UPHELD / 낮음↔REJECTED */
export const VERDICTS = ["UPHELD", "REJECTED"] as const;

/** 주문 유형 5종 — verdict 2치로 눌리기 전의 원본 보존 (0003) */
export const ORDER_TYPES = [
  "UPHELD_AMOUNT", "UPHELD_NO_AMOUNT", "UPHELD_CONFIRM", "REJECTED", "DISMISSED",
] as const;

/** 라벨 출처 — 쟁점·상품군·채널·특성 라벨의 유래 */
export const LABEL_SOURCES = ["ORIGINAL", "MODEL", "RULE", "MIXED"] as const;

/** 익명 이벤트 카운터 5종 (DR-302) */
export const EVENT_TYPES = [
  "JUDGMENT_DONE", "WITHHELD", "RECONSULT_ENTRY", "REPORT_SUBMITTED", "DEMO_VIEWED",
] as const;

/** 오류 신고 상태 (DR-301) */
export const REPORT_STATUSES = ["RECEIVED", "REVIEWING", "CORRECTED", "DISMISSED"] as const;

/** 법령 캐시 출처 (DR-201) — F-501 출처 표기의 원천 */
export const CACHE_SOURCES = ["API", "SNAPSHOT"] as const;

/** 시행일 매핑 도메인 (DR-104) */
export const TIMELINE_DOMAINS = ["SECURITIES", "INSURANCE", "COMMON"] as const;

/** 검증 통계 카테고리 (DR-106) */
export const STAT_CATEGORIES = [
  "HEADLINE", "SECTOR", "METHOD", "UNVERIFIED", "CORRECTION_POLICY",
] as const;

// 쟁점 태그 31종은 여기 없다 — 정본이 DB 룩업 테이블(issue_tags)이다 (DB 명세서 D-1).
// 코드에 열거로 박으면 태그 추가가 스키마·코드 변경이 되어 D-1 설계가 깨진다.
// 런타임은 issue_tags를 SELECT해서 쓴다.

export type Sector = (typeof SECTORS)[number];
export type DbChannel = (typeof DB_CHANNELS)[number];
export type ProductCode = (typeof PRODUCT_CODES)[number];
export type DbTrait = (typeof DB_TRAITS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type OrderType = (typeof ORDER_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

// ---------------------------------------------------------------- 슬롯 열거 (세션 전용)

/** 슬롯 채널 = DB 5종 + UNKNOWN(모름) */
export const SLOT_CHANNELS = [...DB_CHANNELS, "UNKNOWN"] as const;

/** 슬롯 특성 = DB 4종 + NONE(해당 없음) */
export const SLOT_TRAITS = [...DB_TRAITS, "NONE"] as const;

export type SlotChannel = (typeof SLOT_CHANNELS)[number];
export type SlotTrait = (typeof SLOT_TRAITS)[number];

/** 가입 당시 만 나이 범위 (기능 명세 2.1) */
export const AGE_MIN = 19;
export const AGE_MAX = 120;

/** ELDER 자동 파생 기준 — "고령(60대 이상)" (기획서 6.3) */
export const ELDER_AGE = 60;

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------------------------------------------------------- 슬롯 스키마 — F-605의 구현체

/**
 * 필수 슬롯 5종. 열거·정수 외 값은 하위 계층에 전달되지 않는다 (F-605).
 * 검증 실패는 예외가 아니라 되묻기 회귀다 (EX-101) — 호출부는 safeParse를 쓴다.
 */
/**
 * 슬롯 필드 정의. **되묻기는 슬롯을 하나씩 채우므로 부분 검증이 필요하다** —
 * 그래서 refine이 붙지 않은 순수 객체 스키마를 따로 export한다.
 * `.partial()`을 걸어 들어온 필드만 검증하는 용도다 (slots.ts applySlots).
 */
export const SlotsBaseSchema = z
  .object({
    /** 판매채널 */
    channel: z.enum(SLOT_CHANNELS),
    /** 가입 당시 만 나이 (현재 나이가 아니다 — 규제 적용 기준 시점) */
    age: z.union([z.literal("UNKNOWN"), z.number().int().min(AGE_MIN).max(AGE_MAX)]),
    /** 상품군 */
    product: z.enum(PRODUCT_CODES),
    /** 가입 연월 — 기준일 산정(F-303)과 금소법 분기점 판정의 근거 */
    contract_ym: z.union([z.literal("UNKNOWN"), z.string().regex(YM_RE)]),
    /** 소비자 특성 (복수) */
    traits: z.array(z.enum(SLOT_TRAITS)).min(1),

    // 조건부 3종 — 발동 조건 충족 시 필수로 승격 (기능 명세 2.2).
    // 승격 판정은 쟁점이 필요해 에이전트 계층(B-3)에서 하고, 여기선 값 형식만 본다.
    /** 사후확인콜(해피콜) — 보험 + 설명의무 쟁점 시 필수 */
    confirm_call: z.enum(["Y", "N", "UNKNOWN"]).optional(),
    /** 적합성 설문 작성자 — 적합성 원칙 쟁점 시 필수 */
    survey_writer: z.enum(["SELF", "SALES", "UNKNOWN"]).optional(),
    /** 원금손실 설명 수령 — INV_* + 설명의무 쟁점 시 필수 */
    explained_loss: z.enum(["Y", "N", "UNKNOWN"]).optional(),
  })
  .strict(); // 정의 밖 필드 유입 차단 — 자유 문자열이 슬롯에 얹혀 내려가는 경로를 막는다

/** 완성된 슬롯 검증. 조사 계층으로 넘기기 직전에 한 번 통과해야 한다 */
export const SlotsSchema = SlotsBaseSchema
  .refine((s) => !(s.traits.includes("NONE") && s.traits.length > 1), {
    message: "NONE은 다른 특성과 함께 선택할 수 없다",
    path: ["traits"],
  })
  .refine((s) => new Set(s.traits).size === s.traits.length, {
    message: "특성 중복 선택",
    path: ["traits"],
  });

export type Slots = z.infer<typeof SlotsSchema>;

/**
 * ELDER 자동 파생 — 나이는 직접 묻고 고령 여부는 묻지 않는다 (기능 명세 2.1).
 * age ≥ 60이면 ELDER를 추가하고, 그로 인해 NONE 단독이 깨지면 NONE을 제거한다.
 */
export function deriveTraits(age: Slots["age"], declared: readonly SlotTrait[]): SlotTrait[] {
  const set = new Set<SlotTrait>(declared);
  if (age !== "UNKNOWN" && age >= ELDER_AGE) {
    set.add("ELDER");
    if (set.size > 1) set.delete("NONE");
  }
  return [...set];
}

// ---------------------------------------------------------------- 코퍼스 규모

/**
 * 랜딩(S-01)이 배지에 거는 코퍼스 건수.
 *
 * **상수로 두는 이유** — 랜딩은 서비스의 입구라 DB가 죽어도 떠야 하고(N-3xx),
 * 정적 LCP 목표(2.5초)가 걸려 있어 이 한 문장을 위해 쿼리를 붙일 수 없다.
 *
 * **그래서 드리프트를 테스트가 잡는다** — `enums-db.test.ts`가 이 값을 `cases`
 * 실제 행 수와 대조한다. 코퍼스를 적재하면 여기도 같이 고쳐야 하고, 안 고치면
 * 테스트가 실패한다. 실제로 2026.08.30 회수 적재(360 → 388) 때 이 배지만
 * 360에 남아 화면이 없는 수치를 말하고 있었다.
 */
export const CORPUS_SIZE = 388;

/**
 * 개인정보 처리방침(N-504)이 「가상의 사례 n건으로 시험했다」로 거는 합성 PII 세트 크기.
 *
 * **CORPUS_SIZE와 같은 이유로 상수다** — 처리방침은 정적 페이지이고, 시험 세트는
 * 테스트 픽스처라 앱 코드가 가져다 쓸 자리가 아니다.
 *
 * **드리프트는 테스트가 잡는다** — `pii-n501.test.ts`가 `PII_CASES.length`와 대조한다.
 * DB도 필요 없는 코드 대 코드 대조라 CI에서 늘 돈다. 실제로 이 값이 117에 남아
 * 세트가 132가 된 뒤에도 화면이 117을 말하고 있었다 (2026.08.31).
 */
export const PII_TEST_SET_SIZE = 132;
