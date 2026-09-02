/**
 * DR-302 익명 이벤트 카운터 — **횟수만 센다.**
 *
 * KPI(기획서 12.3 — 유보 후 재상담 전환율 등)를 재려면 무언가는 세야 하는데,
 * 세는 행위가 세션 재구성 경로가 되면 안 된다. 그래서 이 표는 개별 이벤트 행을
 * 남기지 않고 **(이벤트, 날짜) 단위 합계만** 갱신한다 — 시각 상관관계로도 개인
 * 세션을 복원할 수 없다 (DB 명세 4.4 · 데이터 명세 DR-302).
 *
 * 저장하지 않는 것: 세션 ID · IP · 슬롯 값 · 내용. 인자로 받지도 않는다.
 *
 * ⚠️ 실패해도 사용자 흐름을 막지 않는다. 카운터는 관측 수단이지 기능이 아니므로,
 * 여기서 예외를 던지면 판단 결과를 못 보여주는 사고가 난다 (EP-3).
 */

import "server-only";
import { sql } from "../db";
import { EVENT_TYPES, type EventType } from "../types";

/**
 * 이벤트 5종의 정본은 `types.ts`의 `EVENT_TYPES`다 — 여기서 다시 선언하지 않는다.
 * 그 배열은 DB CHECK 제약과 대조하는 테스트(enums-db)의 검사 대상이라, 복제하면
 * 대조를 받지 않는 두 번째 정의가 생긴다.
 */
export type CounterEvent = EventType;

/**
 * 클라이언트가 직접 올릴 수 있는 이벤트.
 *
 * 나머지 3종은 서버 경로에서만 오른다 — `JUDGMENT_DONE`·`WITHHELD`는 판단
 * 파이프라인이, `REPORT_SUBMITTED`는 신고 접수가 올린다. 브라우저가 판단 완료
 * 수를 올릴 수 있으면 KPI가 측정값이 아니라 조작 가능한 숫자가 된다.
 */
export const CLIENT_COUNTER_EVENTS = ["RECONSULT_ENTRY", "DEMO_VIEWED"] as const;

export type ClientCounterEvent = (typeof CLIENT_COUNTER_EVENTS)[number];

export function isCounterEvent(v: unknown): v is CounterEvent {
  return typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);
}

export function isClientCounterEvent(v: unknown): v is ClientCounterEvent {
  return typeof v === "string" && (CLIENT_COUNTER_EVENTS as readonly string[]).includes(v);
}

/** 테스트가 트랜잭션을 넘겨 롤백할 수 있게 열어둔다 — app_runtime에 DELETE 권한이 없어서 정리가 불가능하다 */
export type SqlExec = typeof sql;

/**
 * 하루치 합계를 1 올린다.
 *
 * 날짜 경계는 **KST 기준**이다. 한국 이용자 대상 서비스라 UTC 자정으로 끊으면
 * 오전 9시 이전 이벤트가 전날로 붙는다. 배포 리전이 바뀌어도 값이 흔들리지
 * 않도록 앱 시각이 아니라 **DB 시각**으로 계산한다.
 *
 * @returns 반영 여부. 실패는 삼키고 false를 돌려준다 (호출부가 흐름을 멈추지 않도록)
 */
export async function bumpCounter(
  event: CounterEvent,
  exec: SqlExec = sql,
): Promise<boolean> {
  try {
    await exec`
      insert into usage_counters (event_type, event_date, cnt)
      values (${event}, (now() at time zone 'Asia/Seoul')::date, 1)
      on conflict (event_type, event_date)
      do update set cnt = usage_counters.cnt + 1
    `;
    return true;
  } catch (e) {
    // 허용 로그 필드만 남긴다: 이벤트 유형 + DB 오류 코드 (CLAUDE.md 절대규칙 3).
    // 예외 메시지 전문을 찍으면 값이 섞여 들어올 수 있어 코드만 집는다.
    console.warn(`[ops] counter bump failed event=${event} pg=${pgCode(e)}`);
    return false;
  }
}

/** postgres 오류에서 SQLSTATE만 뽑는다. 메시지·파라미터는 로그에 남기지 않는다 */
export function pgCode(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const c = (e as { code: unknown }).code;
    if (typeof c === "string") return c;
  }
  return "UNKNOWN";
}
