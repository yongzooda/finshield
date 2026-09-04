/**
 * 기관 화면 ② — 반복되는 쟁점 (기획서 7.1 「반복 쟁점 리스트」).
 *
 * ## 배상비율을 어떻게 다루나
 *
 * SR-X10은 배상비율을 표시하려면 **「참고 사례 n=N 기준이며 예측치가 아닙니다」를
 * 병기**하도록 요구한다. 병기할 수 없으면 표시하지 않는다. 여기서는 줄마다
 * 자리가 있으므로 **표본 수와 범위를 함께** 적는다 — 중앙값만 두면 예측치로
 * 읽힌다.
 *
 * 배상비율은 사건 수와 **표본이 다르다.** 원문에 비율이 적힌 사례가 30건뿐이라,
 * 「사례 40건 · 배상비율 표본 3건」 같은 줄이 정상이다. 그 차이를 숨기지 않는다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { issueRows } from "@/lib/insight/aggregate";
import { InsightNotice, Population, SmallSample, VerdictBar, channelKo } from "../views";

export const metadata: Metadata = { title: "반복되는 쟁점 — 프리케이스" };
/**
 * PreCase 기준선 화면이다. PreCase 코퍼스 테이블을 읽으므로 FinShield 전용
 * DB에는 대상 테이블이 없다. 빌드 시 사전 렌더하면 존재하지 않는 관계를
 * 조회해 배포 자체가 실패한다. 실패를 감추지 않고 요청 시점으로 옮긴다.
 * FinShield 화면으로 재구현할 때 이 선언과 함께 제거한다.
 */
export const dynamic = "force-dynamic";

export default async function IssueInsight() {
  const { corpus, rows } = await issueRows();
  const withRate = rows.filter((r) => r.rateN > 0).length;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-fg-muted">
        <Link href="/insight" className="text-accent underline">
          분쟁 패턴 지표
        </Link>
      </p>
      <h1 className="mt-2 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        반복되는 쟁점
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        같은 유형이 연도를 가리지 않고 되돌아옵니다.{" "}
        <strong className="text-fg">반복된다는 것은 예방할 수 있다는 뜻</strong>이라, 무엇이
        몇 번 다뤄졌고 어떻게 끝났는지를 그대로 셉니다.
      </p>

      <Population>
        전체 <strong className="text-fg">{corpus}건</strong> 기준입니다. 한 사례에 쟁점이 여러
        개 붙을 수 있어 아래 건수의 합은 {corpus}건보다 큽니다. 배상비율은 원문에 적힌{" "}
        <strong className="text-fg">{withRate}개 쟁점</strong>에서만 셀 수 있었습니다.
      </Population>

      <InsightNotice />

      <section aria-labelledby="list" className="mt-10">
        <h2 id="list" className="text-[1.35rem] font-bold tracking-tight text-fg">
          쟁점 {rows.length}가지
        </h2>
        <ul className="mt-4 space-y-4">
          {rows.map((r) => (
            <li key={r.code} className="rounded-lg border border-border px-5 py-4">
              <p className="text-[1.1rem] font-bold text-fg">
                {r.code}
                <span className="ml-2 font-normal text-fg-muted">사례 {r.n}건</span>
                <SmallSample n={r.n} />
              </p>

              {r.topChannel && (
                <p className="mt-1 text-fg-muted">
                  가장 잦은 경로 — {channelKo(r.topChannel.channel)} {r.topChannel.n}건
                </p>
              )}

              <div className="mt-3">
                <VerdictBar upheld={r.upheld} rejected={r.rejected} />
              </div>

              {/* SR-X10 — 표본과 범위를 병기할 수 없으면 아예 적지 않는다 */}
              {r.rateN > 0 && r.rateMedian !== null && (
                <p className="mt-3 rounded-md bg-bg-subtle px-4 py-3 leading-relaxed text-fg-muted">
                  배상이 인정된 경우의 비율 —{" "}
                  <strong className="text-fg">중앙값 {Math.round(r.rateMedian)}%</strong>
                  {r.rateMin !== null && r.rateMax !== null && r.rateMin !== r.rateMax && (
                    <> (범위 {r.rateMin}~{r.rateMax}%)</>
                  )}
                  <br />
                  <strong className="text-fg">참고 사례 {r.rateN}건 기준이며 예측치가 아닙니다.</strong>{" "}
                  같은 쟁점이라도 사건마다 판단이 다릅니다.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 leading-relaxed text-fg-muted">
        건수가 많다는 것은 <strong className="text-fg">다툼이 잦았다</strong>는 뜻이지 그 쟁점이
        더 잘 인정된다는 뜻이 아닙니다. 인정 여부는 위의 분포를 함께 보셔야 합니다.
      </p>
    </div>
  );
}
