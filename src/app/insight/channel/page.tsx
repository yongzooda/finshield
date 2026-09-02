/**
 * 기관 화면 ① — 채널별 쟁점 집중도 (기획서 7.1 「채널×쟁점 히트맵」).
 *
 * ## 왜 색만으로 그리지 않는가
 *
 * 히트맵은 색 농도로 읽는 그림이다. 그런데 이 코퍼스는 **채널 라벨이 125건**이고
 * 5채널 × 34쟁점으로 흩으면 대부분의 칸이 0\~2다. 색만 두면 2건짜리 칸이
 * 「조금 있음」으로 읽히고, 색을 구분하지 못하는 사람에게는 아무 정보도 남지
 * 않는다. 그래서 **모든 칸에 건수를 적고** 색은 보조로만 쓴다.
 *
 * 열은 상위 쟁점 8개로 자른다. 잘랐다는 사실과 전체 개수를 함께 적는다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { channelIssueMatrix } from "@/lib/insight/aggregate";
import { InsightNotice, Population, SmallSample, VerdictBar, channelKo } from "../views";

export const metadata: Metadata = { title: "채널별 쟁점 집중도 — 프리케이스" };
export const revalidate = 3600;

/** 열로 세울 쟁점 수. 전부 세우면 좁은 화면에서 읽을 수 없다 */
const TOP_ISSUES = 8;

/** 건수를 네 단계 농도로. **색은 보조이고 숫자가 본문이다** */
function tone(n: number, max: number): string {
  if (n === 0) return "bg-bg text-fg-muted";
  const r = n / Math.max(max, 1);
  if (r >= 0.66) return "bg-accent text-accent-fg font-bold";
  if (r >= 0.33) return "bg-accent-soft text-navy font-bold";
  return "bg-bg-subtle text-fg";
}

export default async function ChannelInsight() {
  const m = await channelIssueMatrix();
  const cols = m.issues.slice(0, TOP_ISSUES);
  const max = Math.max(1, ...Object.values(m.cells).map((c) => c.n));

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-fg-muted">
        <Link href="/insight" className="text-accent underline">
          분쟁 패턴 지표
        </Link>
      </p>
      <h1 className="mt-2 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        채널별 쟁점 집중도
      </h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        같은 상품이라도 <strong className="text-fg">어떤 경로로 팔렸는지</strong>에 따라
        다퉈지는 쟁점이 달라집니다. 설명의무를 무엇으로 입증하느냐가 채널마다 다르기
        때문입니다.
      </p>

      <Population>
        판매채널이 원문에 적힌 <strong className="text-fg">{m.labelled}건</strong> 기준입니다
        (전체 {m.corpus}건 중). 채널이 적혀 있지 않은 사례는 세지 않았습니다.
      </Population>

      <InsightNotice />

      {/* ── 표 */}
      <section aria-labelledby="matrix" className="mt-10">
        <h2 id="matrix" className="text-[1.35rem] font-bold tracking-tight text-fg">
          채널 × 쟁점
        </h2>
        <p className="mt-2 leading-relaxed text-fg-muted">
          칸의 숫자는 그 채널에서 해당 쟁점이 다뤄진 <strong className="text-fg">사례 수</strong>
          입니다. 쟁점 {m.issues.length}개 중 <strong className="text-fg">많이 나온 {cols.length}개</strong>
          만 세웠습니다. 색은 보기를 돕는 것일 뿐 숫자가 본문입니다.
        </p>

        {/* 좁은 화면에서는 가로로 밀어서 본다 — 본문이 밀리지 않게 이 안에서만 */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-max border-collapse text-[0.95rem]">
            <caption className="sr-only">
              판매채널별로 각 쟁점이 다뤄진 사례 수
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-bg px-3 py-2 text-left">
                  채널
                </th>
                {cols.map((c) => (
                  <th
                    key={c.code}
                    scope="col"
                    className="px-2 py-2 align-bottom text-left font-bold text-fg"
                  >
                    <span className="block w-20 leading-tight">{c.code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.channels.map((ch) => (
                <tr key={ch.channel} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-bg px-3 py-2 text-left font-bold text-fg"
                  >
                    {channelKo(ch.channel)}
                    <span className="ml-1 font-normal text-fg-muted">{ch.n}건</span>
                  </th>
                  {cols.map((c) => {
                    const cell = m.cells[`${ch.channel}|${c.code}`];
                    const n = cell?.n ?? 0;
                    return (
                      <td key={c.code} className="px-1 py-1">
                        <div
                          className={"flex h-11 w-20 items-center justify-center rounded " + tone(n, max)}
                        >
                          {n === 0 ? "·" : n}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 채널별 상세 */}
      <section aria-labelledby="by-channel" className="mt-12">
        <h2 id="by-channel" className="text-[1.35rem] font-bold tracking-tight text-fg">
          채널별로 보기
        </h2>
        <ul className="mt-4 space-y-4">
          {m.channels.map((ch) => {
            const rows = m.issues
              .map((i) => ({ code: i.code, cell: m.cells[`${ch.channel}|${i.code}`] }))
              .filter((r) => r.cell)
              .sort((a, b) => b.cell!.n - a.cell!.n)
              .slice(0, 5);
            const upheld = rows.reduce((s, r) => s + r.cell!.upheld, 0);
            const rejected = rows.reduce((s, r) => s + r.cell!.rejected, 0);
            return (
              <li key={ch.channel} className="rounded-lg border border-border px-5 py-4">
                <p className="text-[1.1rem] font-bold text-fg">
                  {channelKo(ch.channel)}
                  <span className="ml-2 font-normal text-fg-muted">사례 {ch.n}건</span>
                  <SmallSample n={ch.n} />
                </p>

                {rows.length === 0 ? (
                  <p className="mt-2 leading-relaxed text-fg-muted">
                    이 채널에는 쟁점이 분류된 사례가 없습니다.
                  </p>
                ) : (
                  <>
                    <ul className="mt-3 space-y-1">
                      {rows.map((r) => (
                        <li key={r.code} className="leading-relaxed text-fg">
                          · {r.code}{" "}
                          <span className="text-fg-muted">{r.cell!.n}건</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3">
                      <VerdictBar upheld={upheld} rejected={rejected} />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-10 leading-relaxed text-fg-muted">
        위 숫자는 지금까지 공개된 조정 사례를 센 것입니다.{" "}
        <strong className="text-fg">앞으로의 결과를 예측한 값이 아니며</strong>, 표본이 적은
        채널은 사례가 몇 건만 더해져도 순위가 바뀔 수 있습니다.
      </p>
    </div>
  );
}
