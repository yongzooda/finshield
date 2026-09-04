/**
 * S-06 검증 결과 (SR-206 · F-403) — **축소 불가 화면**.
 *
 * 목적은 "서비스가 자기 성능을 상시 공개한다"이다. 정확성 관리 정책의 구현체라
 * 일정이 밀려도 이 화면은 빼지 않는다 (범위 문서 9장).
 *
 * 필수 구성 7종:
 *   ① 결론 구간 정확도 + 신뢰구간   ② 커버리지   ③ 전체 정확도 병기
 *   ④ 업권별 편차(n·변동 폭 병기)   ⑤ 검증되지 않은 항목   ⑥ 측정 방법   ⑦ 오류 정정 이력
 *
 * 금지: 유리한 수치만 발췌 · **한계 항목(⑤)을 접거나 숨기는 UI**
 * 수치의 유일한 원천은 DR-106 `validation_stats`다 (Q-3).
 */

import type { Metadata } from "next";
import { getValidationPageData } from "@/lib/validation-stats";
import { HeadlineStat, MethodStat, SectorStat, UnverifiedStat } from "./stat-views";

export const metadata: Metadata = {
  title: "검증 결과 — 프리케이스",
  description:
    "프리케이스의 판단 정확도·커버리지·업권별 편차와 검증되지 않은 항목을 실측값으로 공개합니다.",
};

// 정적 자산이지만 배치 재측정 후 반영이 늦지 않도록 1시간마다 재생성한다.
/**
 * PreCase 기준선 화면이다. PreCase 코퍼스 테이블을 읽으므로 FinShield 전용
 * DB에는 대상 테이블이 없다. 빌드 시 사전 렌더하면 존재하지 않는 관계를
 * 조회해 배포 자체가 실패한다. 실패를 감추지 않고 요청 시점으로 옮긴다.
 * FinShield 화면으로 재구현할 때 이 선언과 함께 제거한다.
 */
export const dynamic = "force-dynamic";

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-[1.35rem] font-bold tracking-tight text-fg">
        {title}
      </h2>
      {lead && <p className="mt-2 leading-relaxed text-fg-muted">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function VerificationPage() {
  const { headline, sector, method, unverified, correctionPolicy, corrections } =
    await getValidationPageData();

  /**
   * 안전성 시험(R-08 · A5 레드팀)은 저장상 METHOD에 있지만 화면에서는 따로
   * 가른다 — 「어떻게 쟀나」와 「공격에 어떻게 버티나」는 독자의 질문이 다르다.
   * 스키마를 늘리지 않은 이유는 이 자리에 이미 같은 성격의 실측이 있어서다
   * (개인정보 가림·환각 대조). 구획은 저장이 아니라 화면의 관심사다.
   */
  const safety = method.filter((s) => s.metricKey.startsWith("safety_"));
  const howMeasured = method.filter((s) => !s.metricKey.startsWith("safety_"));

  return (
    <article className="mx-auto max-w-3xl px-5 py-10">
      <header>
        <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
          검증 결과
        </h1>
        <p className="mt-3 leading-relaxed text-fg-muted">
          프리케이스가 실제로 얼마나 맞히는지, 무엇을 아직 확인하지 못했는지를 그대로
          공개합니다. 아래 수치는 공개된 분쟁조정 선례로 측정한 실측값이며, 유리한 수치만
          골라 싣지 않습니다.
        </p>
      </header>

      {/* ① ② ③ 핵심 지표 */}
      <Section
        id="headline"
        title="핵심 지표"
        /*
          설계를 숫자보다 **먼저** 말한다 (2026.09.01).

          「결론을 내는 비율 27.1%」는 1.6rem 굵은 글씨로 먼저 읽히고, 왜 낮은지는
          그 아래 회색 note에 있었다. 빠르게 읽는 사람에게 그 순서는
          「네 번 중 세 번은 답을 못 준다」로 읽힌다 — 실제로는 맞바꾼 값인데
          맞바꿈이 나중에 나온다. lead가 그 순서를 뒤집는다.

          note를 고쳐서 해결하지 않는 이유 — 수치와 단서의 유일한 출처는
          `validation_stats`이고(Q-3), 화면 산문이 할 일을 DB 행에 밀어 넣으면
          재적재 때마다 흔들린다. 읽는 순서는 화면의 관심사다.
        */
        lead="프리케이스는 확신이 설 때만 결론을 냅니다. 그래서 「결론을 내는 비율」은 낮고 그 대신 「결론을 냈을 때의 정확도」가 높습니다 — 둘은 맞바꾼 값이라 함께 봐야 하고, 하나만 보면 성능이 과대·과소평가됩니다. 결론을 내지 않은 사건에는 어떤 자료가 있으면 판단할 수 있는지 알려드립니다."
      >
        <div>
          {headline.map((s) => (
            <HeadlineStat key={s.metricKey} stat={s} />
          ))}
        </div>
      </Section>

      {/* ④ 업권별 편차 — 낮은 업권도 숨기지 않는다 */}
      <Section
        id="sector"
        title="업권별 편차"
        lead="업권마다 정확도가 다릅니다. 낮게 나온 업권도 그대로 싣습니다. 업권별 수치는 한 번만 측정한 값이라, 다시 측정하면 순위가 바뀔 수 있습니다. 표본이 작은 업권은 신뢰구간이 넓어 수치 하나만으로 판단할 수 없습니다."
      >
        <ul className="space-y-3">
          {sector.map((s) => (
            <SectorStat key={s.metricKey} stat={s} />
          ))}
        </ul>
      </Section>

      {/* ⑤ 검증되지 않은 항목 — 접이식 금지 */}
      <Section
        id="unverified"
        title="아직 검증하지 못한 것"
        lead="측정하지 않았거나, 측정했지만 효과가 확인되지 않은 항목입니다. 부정적인 결과도 함께 공개합니다."
      >
        <ul className="space-y-3">
          {unverified.map((s) => (
            <UnverifiedStat key={s.metricKey} stat={s} />
          ))}
        </ul>
      </Section>

      {/* 안전성 시험 (R-08) — 공격을 넣어 보고 무엇이 뚫렸는지까지 적는다 */}
      {safety.length > 0 && (
        <Section
          id="safety"
          title="안전성 시험"
          lead="일부러 공격을 넣어 방어가 버티는지 확인한 결과입니다. 뚫린 것이 있으면 그것도 적습니다 — 실제로 이 시험에서 구멍이 하나 나왔고, 찾은 날 고쳤습니다."
        >
          <dl>
            {safety.map((s) => (
              <MethodStat key={s.metricKey} stat={s} />
            ))}
          </dl>
        </Section>
      )}

      {/* ⑥ 측정 방법 */}
      <Section
        id="method"
        title="측정 방법"
        lead="어떤 데이터로 어떻게 쟀는지입니다. 방법을 밝히지 않은 수치는 검증된 수치가 아닙니다."
      >
        <dl>
          {howMeasured.map((s) => (
            <MethodStat key={s.metricKey} stat={s} />
          ))}
        </dl>
      </Section>

      {/* ⑦ 오류 정정 이력 */}
      <Section
        id="corrections"
        title="오류 정정 이력"
        lead="판단이 사실과 다르다는 신고를 받으면 검토하고, 정정한 내용을 여기에 공개합니다."
      >
        <dl>
          {correctionPolicy.map((s) => (
            <MethodStat key={s.metricKey} stat={s} />
          ))}
        </dl>

        {corrections.length === 0 ? (
          <p className="mt-4 rounded-md border border-border bg-bg-subtle px-4 py-4 text-fg-muted">
            아직 공개된 정정 이력이 없습니다. 접수되어 정정이 완료되면 이 자리에
            표시됩니다.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {corrections.map((c) => (
              <li key={c.id} className="rounded-md border border-border px-4 py-4">
                <p className="text-fg-muted">
                  접수 {c.reportedOn}
                  {c.correctedAt && ` · 정정 ${c.correctedAt}`}
                </p>
                <p className="mt-1 text-fg">{c.correctionNote}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </article>
  );
}
