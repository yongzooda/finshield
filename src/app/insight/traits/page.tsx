/**
 * 기관 화면 ③ — 소비자 특성별 분포 (기획서 7.1).
 *
 * ## 이 화면은 「얇다」는 사실이 본문이다
 *
 * 소비자 특성은 조정결정서의 **「위원회 판단」 부분에서만** 드러나는 경우가 많다.
 * 사실관계에 「67세」라고 적히는 대신 판단 이유에 「고령의 신청인에게…」로 나오는
 * 식이다. 그래서 라벨 부착률이 낮고(실측 39/388), 이 한계는 검증 결과 화면
 * (S-06)에도 「연령·소비자 특성별 정확도 — 측정 불가」로 이미 공개돼 있다.
 *
 * 그 사실을 흐리고 퍼센트만 그리면 **1건짜리 특성이 지표처럼 보인다.** 그래서
 * 부착률을 맨 위에 두고, 각 줄에 건수를 붙이고, 표본이 얇으면 배지를 단다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { traitDistribution } from "@/lib/insight/aggregate";
import { InsightNotice, Population, SmallSample, TRAIT_KO, VerdictBar } from "../views";

export const metadata: Metadata = { title: "소비자 특성별 분포 — 프리케이스" };
/**
 * PreCase 기준선 화면이다. PreCase 코퍼스 테이블을 읽으므로 FinShield 전용
 * DB에는 대상 테이블이 없다. 빌드 시 사전 렌더하면 존재하지 않는 관계를
 * 조회해 배포 자체가 실패한다. 실패를 감추지 않고 요청 시점으로 옮긴다.
 * FinShield 화면으로 재구현할 때 이 선언과 함께 제거한다.
 */
export const dynamic = "force-dynamic";

export default async function TraitInsight() {
  const d = await traitDistribution();
  const pct = d.corpus === 0 ? 0 : Math.round((d.labelled / d.corpus) * 100);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-fg-muted">
        <Link href="/insight" className="text-accent underline">
          분쟁 패턴 지표
        </Link>
      </p>
      <h1 className="mt-2 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        소비자 특성별 분포
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        고령·투자 경험 부족 같은 특성은 <strong className="text-fg">보호 규제의 적용 여부</strong>
        를 가릅니다. 어떤 특성에서 어떤 쟁점이 몰리는지 봅니다.
      </p>

      {/* 한계가 먼저다 — 이 화면에서는 그것이 가장 중요한 정보다 */}
      <div className="mt-6 rounded-md border-l-4 border-warn-border bg-warn-bg px-4 py-3">
        <p className="font-bold text-warn-fg">이 축은 표본이 가장 얇습니다</p>
        <p className="mt-1 leading-relaxed text-warn-fg">
          특성이 원문에 드러난 사례는 <strong>{d.labelled}건</strong>으로 전체 {d.corpus}건의{" "}
          <strong>{pct}%</strong>입니다. 특성은 사실관계가 아니라 결정문의 「위원회 판단」
          서술에서만 확인되는 경우가 많기 때문입니다. 아래 수치는{" "}
          <strong>경향을 가늠하는 용도</strong>이며, 몇 건만 더해져도 순위가 바뀝니다.
        </p>
      </div>

      <Population>
        특성이 적힌 <strong className="text-fg">{d.labelled}건</strong> 기준입니다. 한 사례에
        특성이 여러 개 붙을 수 있어 아래 건수의 합은 {d.labelled}건보다 클 수 있습니다.
      </Population>

      <InsightNotice />

      <section aria-labelledby="rows" className="mt-10">
        <h2 id="rows" className="text-[1.35rem] font-bold tracking-tight text-fg">
          특성별로 보기
        </h2>

        {d.rows.length === 0 ? (
          <p className="mt-4 leading-relaxed text-fg-muted">
            특성이 분류된 사례가 아직 없습니다.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {d.rows.map((r) => (
              <li key={r.trait} className="rounded-lg border border-border px-5 py-4">
                <p className="text-[1.1rem] font-bold text-fg">
                  {TRAIT_KO[r.trait]}
                  <span className="ml-2 font-normal text-fg-muted">사례 {r.n}건</span>
                  <SmallSample n={r.n} />
                </p>

                {r.topIssues.length > 0 && (
                  <>
                    <p className="mt-3 font-bold text-fg">이 특성에서 잦은 쟁점</p>
                    <ul className="mt-1 space-y-1">
                      {r.topIssues.map((i) => (
                        <li key={i.code} className="leading-relaxed text-fg">
                          · {i.code} <span className="text-fg-muted">{i.n}건</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="mt-3">
                  <VerdictBar upheld={r.upheld} rejected={r.rejected} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 leading-relaxed text-fg-muted">
        같은 한계를{" "}
        <Link href="/verification" className="text-accent underline">
          검증 결과
        </Link>
        에도 「연령·소비자 특성별 정확도 — 측정 불가」로 적어 두었습니다. 측정하지 못한
        것을 측정한 것처럼 쓰지 않습니다.
      </p>
    </div>
  );
}
