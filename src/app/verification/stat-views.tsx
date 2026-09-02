/**
 * S-06 지표 렌더링 컴포넌트.
 *
 * **CLAUDE.md 「S-06 렌더링 규약」의 구현체다.** 절대 규칙 1(환각 방지)이 근거
 * 컴포넌트에 문자열 대신 도구 반환 객체만 받게 한 것과 같은 방식으로, 여기서는
 * `ValidationStat` **행 객체 전체**만 받는다.
 *
 *   - props가 `stat: ValidationStat` 하나뿐이라 숫자만 떼어 넘길 방법이 없다
 *   - `note`가 타입상 필수라 단서를 빠뜨린 행은 애초에 만들어지지 않는다
 *   - 업권별 행은 퍼센트 단독 표시가 불가능하다 — n·CI·note가 같은 컴포넌트에 묶여 있다
 *
 * 신뢰구간은 로더가 실측 카운트에서 Wilson으로 계산해 DB에 넣은 값이다.
 * 여기서 계산하거나 상수로 적지 않는다.
 */

import { isSmallSample, type ValidationStat } from "@/lib/validation-stats";

/** 한계·단서 표시. 어느 지표에서도 생략되지 않는다 (S-06 금지: 한계 숨김) */
function Note({ children }: { children: string }) {
  return (
    <p className="mt-2 leading-relaxed text-fg-muted">
      <span aria-hidden="true">※ </span>
      {children}
    </p>
  );
}

function ConfidenceInterval({ low, high }: { low: number; high: number }) {
  return (
    <span className="whitespace-nowrap text-fg-muted">
      95% 신뢰구간 {low}~{high}%
    </span>
  );
}

/** ① ② ③ 핵심 지표 */
export function HeadlineStat({ stat }: { stat: ValidationStat }) {
  return (
    <div className="border-t border-border py-5 first:border-t-0">
      <h3 className="font-semibold text-fg-muted">{stat.displayKo}</h3>
      <p className="mt-1 text-[1.6rem] font-bold leading-tight tracking-tight text-fg">
        {stat.display}
      </p>

      {stat.ciLow !== null && stat.ciHigh !== null && (
        <p className="mt-1">
          <ConfidenceInterval low={stat.ciLow} high={stat.ciHigh} />
        </p>
      )}

      {/* 커버리지처럼 재현 회차가 있는 지표는 회차별 실측을 함께 보인다 */}
      {stat.runs && (
        <ul className="mt-2 space-y-1 text-fg-muted">
          {stat.runs.map((r) => (
            <li key={r.run}>
              {r.run}회차 {r.value}% ({r.numerator}/{r.denominator})
            </li>
          ))}
        </ul>
      )}

      <Note>{stat.note}</Note>
    </div>
  );
}

/**
 * ④ 업권별 편차. **퍼센트 단독 표시 금지** — n과 신뢰구간을 항상 동반한다.
 * 표본이 작은 업권(n<20)은 구간이 넓어 단독 수치가 오해를 만들기 때문이다.
 */
export function SectorStat({ stat }: { stat: ValidationStat }) {
  const small = isSmallSample(stat);
  return (
    <li
      className={`rounded-md border px-4 py-4 ${
        small ? "border-warn-border bg-warn-bg" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[1.15rem] font-bold text-fg">{stat.display}</span>
        {stat.ciLow !== null && stat.ciHigh !== null && (
          <ConfidenceInterval low={stat.ciLow} high={stat.ciHigh} />
        )}
      </div>
      {/* 설명 문장은 note가 담는다 — 컴포넌트가 같은 말을 반복하지 않게 배지만 붙인다 */}
      {small && (
        <p className="mt-2">
          <span className="rounded border border-warn-border px-2 py-1 font-bold text-warn-fg">
            표본 부족
          </span>
        </p>
      )}
      <Note>{stat.note}</Note>
    </li>
  );
}

/** ⑥ 측정 방법 요약 */
export function MethodStat({ stat }: { stat: ValidationStat }) {
  return (
    <div className="border-t border-border py-4 first:border-t-0">
      <dt className="font-semibold text-fg-muted">{stat.displayKo}</dt>
      <dd className="mt-1 text-fg">{stat.display}</dd>
      <dd>
        <Note>{stat.note}</Note>
      </dd>
    </div>
  );
}

/**
 * ⑤ 검증되지 않은 항목. **접이식(details)으로 만들지 않는다** —
 * 화면 명세 S-06의 금지사항이 "한계 항목을 접거나 숨기는 UI"다.
 */
export function UnverifiedStat({ stat }: { stat: ValidationStat }) {
  // 항목이 10개를 넘으므로 전면 경고색을 쓰지 않는다 — 경고가 반복되면 각 항목의
  // 무게가 사라지고 읽히지 않는다. 왼쪽 굵은 선으로 구간을 표시하고 본문은 읽기 쉽게 둔다.
  return (
    <li className="rounded-md border border-border border-l-4 border-l-warn-border bg-bg px-4 py-4">
      <h3 className="text-[1.02rem] font-bold leading-snug text-fg">{stat.displayKo}</h3>
      <p className="mt-1 text-fg">{stat.display}</p>
      <Note>{stat.note}</Note>
    </li>
  );
}
