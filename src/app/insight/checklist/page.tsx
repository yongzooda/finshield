/**
 * 기관 화면 ④ — 판매 과정 점검 항목 (기획서 7.1 「판매 프로세스 점검 항목」).
 *
 * ## 분쟁 패턴에서 역산한다
 *
 * 「무엇을 점검해야 하는가」를 일반론으로 쓰지 않는다. **그 채널에서 실제로
 * 다퉈진 쟁점**을 세고, 그 쟁점을 다투려면 무엇이 남아 있어야 하는지를 채널의
 * 성질에서 가져온다 — 전화 판매는 설명이 통화에만 남고, 창구는 서명본에 남는다.
 *
 * ⚠️ **점검 문장이 없는 채널이 와도 화면이 죽지 않아야 한다.** 빌드가 9개 워커로
 * 동시에 프리렌더하던 중 열거에 없는 채널을 받아 페이지 전체가 무너진 적이 있다
 * (2026.08.25). 한 행의 문제로 지표 전체가 사라지는 것이 더 나쁘므로, 문장이
 * 없으면 **건수는 살리고 문장 자리에만 그 사실을 적는다** — 감추지 않는다.
 *
 * 점검 문장은 **코드가 만든다.** 모델을 부르지 않으므로 지어낼 여지가 없고,
 * 각 항목 옆의 건수는 전부 집계에서 온 값이다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { channelChecklists } from "@/lib/insight/aggregate";
import { InsightNotice, Population, SmallSample, VerdictBar, channelKo } from "../views";
import { CHANNEL_POINTS } from "@/lib/insight/checklist-points";

export const metadata: Metadata = { title: "판매 과정 점검 항목 — 프리케이스" };
/**
 * PreCase 기준선 화면이다. PreCase 코퍼스 테이블을 읽으므로 FinShield 전용
 * DB에는 대상 테이블이 없다. 빌드 시 사전 렌더하면 존재하지 않는 관계를
 * 조회해 배포 자체가 실패한다. 실패를 감추지 않고 요청 시점으로 옮긴다.
 * FinShield 화면으로 재구현할 때 이 선언과 함께 제거한다.
 */
export const dynamic = "force-dynamic";

export default async function ChecklistInsight() {
  const { labelled, rows } = await channelChecklists();

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-fg-muted">
        <Link href="/insight" className="text-accent underline">
          분쟁 패턴 지표
        </Link>
      </p>
      <h1 className="mt-2 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        판매 과정 점검 항목
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        분쟁에서 실제로 문제가 된 지점을 거꾸로 짚었습니다.{" "}
        <strong className="text-fg">채널마다 「설명했다」를 입증하는 수단이 다르므로</strong>{" "}
        점검할 것도 다릅니다.
      </p>

      <Population>
        판매채널이 원문에 적힌 <strong className="text-fg">{labelled}건</strong>에서 쟁점을
        세었습니다. 아래 점검 문장은 그 쟁점을 다투려면 무엇이 남아 있어야 하는지를
        채널의 성질에서 가져온 것이며, <strong className="text-fg">감독 지침이 아닙니다.</strong>
      </Population>

      <InsightNotice />

      <section aria-labelledby="rows" className="mt-10">
        <h2 id="rows" className="text-[1.35rem] font-bold tracking-tight text-fg">
          채널별 점검표
        </h2>

        <ul className="mt-4 space-y-6">
          {rows.map((r) => {
            const p = CHANNEL_POINTS[r.channel];
            return (
              <li key={r.channel} className="rounded-lg border-2 border-border px-5 py-5">
                <p className="text-[1.15rem] font-bold text-navy">
                  {channelKo(r.channel)}
                  <span className="ml-2 text-[1rem] font-normal text-fg-muted">
                    사례 {r.n}건
                  </span>
                  <SmallSample n={r.n} />
                </p>
                <p className="mt-1 leading-relaxed text-fg-muted">
                  {p ? p.title : "이 경로의 점검 문장은 아직 정해지지 않았습니다"}
                </p>

                {r.issues.length > 0 && (
                  <>
                    <p className="mt-4 font-bold text-fg">이 경로에서 실제로 다퉈진 쟁점</p>
                    <ul className="mt-1 space-y-1">
                      {r.issues.map((i) => (
                        <li key={i.code} className="leading-relaxed text-fg">
                          · {i.code} <span className="text-fg-muted">{i.n}건</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {p && (
                  <>
                    <p className="mt-4 font-bold text-fg">그래서 점검할 것</p>
                    <ul className="mt-1 space-y-2">
                      {p.items.map((it) => (
                        <li key={it} className="flex gap-2 leading-relaxed text-fg">
                          <span aria-hidden="true" className="text-accent">
                            □
                          </span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <div className="mt-4">
                  <VerdictBar upheld={r.upheld} rejected={r.rejected} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-10 leading-relaxed text-fg-muted">
        이 점검표는 <strong className="text-fg">공개 분쟁조정 사례에서 역산한 참고 자료</strong>
        입니다. 회사의 내부통제 기준을 대신하지 않으며, 특정 금융회사를 평가하지
        않습니다.
      </p>
    </div>
  );
}
