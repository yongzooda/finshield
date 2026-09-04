/**
 * ③ 개선 축 허브 (SR-103).
 *
 * 기획서 1.3의 「하나의 엔진, 세 개의 축」에서 세 번째 축이다. **같은 코퍼스,
 * 같은 집계 함수를 관점만 바꿔** 쓴다 — 예방 축에서 "이 조합에서 이런 분쟁이
 * 있었습니다"로 나가는 값이 여기서는 "이 채널에서 이 쟁점이 집중됩니다"가 된다.
 *
 * 모델을 부르지 않는다. 읽기 전용 집계뿐이라 모델·외부 API 장애와 무관하게 뜬다.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { channelIssueMatrix, traitDistribution } from "@/lib/insight/aggregate";
import { InsightNotice, NoCompanyNotice } from "./views";

export const metadata: Metadata = {
  title: "분쟁 패턴 지표 — 프리케이스",
  description:
    "공개된 금융분쟁조정 사례를 채널·쟁점·소비자 특성으로 집계한 지표입니다. 소비자 상담 내용은 쓰지 않습니다.",
};

/** 코퍼스가 늘면 값이 바뀐다. 1시간마다 다시 만든다 */
/**
 * PreCase 기준선 화면이다. PreCase 코퍼스 테이블을 읽으므로 FinShield 전용
 * DB에는 대상 테이블이 없다. 빌드 시 사전 렌더하면 존재하지 않는 관계를
 * 조회해 배포 자체가 실패한다. 실패를 감추지 않고 요청 시점으로 옮긴다.
 * FinShield 화면으로 재구현할 때 이 선언과 함께 제거한다.
 */
export const dynamic = "force-dynamic";

const CARDS = [
  {
    href: "/insight/channel",
    title: "채널별 쟁점 집중도",
    sub: "어느 판매 경로에서 어떤 분쟁이 몰리는지",
  },
  {
    href: "/insight/issues",
    title: "반복되는 쟁점",
    sub: "무엇이 몇 번 다뤄졌고 어떻게 끝났는지",
  },
  {
    href: "/insight/traits",
    title: "소비자 특성별 분포",
    sub: "고령·투자 경험 부족 등 특성별 집중도",
  },
  {
    href: "/insight/checklist",
    title: "판매 과정 점검 항목",
    sub: "분쟁 패턴에서 역산한 채널별 점검표",
  },
];

export default async function InsightHub() {
  const [m, t] = await Promise.all([channelIssueMatrix(), traitDistribution()]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-[0.95rem] font-bold text-accent">
        금융회사 · 협회 · 감독당국용
      </p>
      <h1 className="mt-3 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
        분쟁 패턴 지표
      </h1>
      <p className="mt-4 text-[1.15rem] leading-relaxed text-fg-muted">
        공개된 금융분쟁조정 사례 {m.corpus}건을 판매채널·쟁점·소비자 특성으로 집계했습니다.
        어디에서 무엇이 반복되는지를 보여 드립니다.
      </p>

      <InsightNotice />

      {/* 무엇을 셀 수 있고 무엇을 셀 수 없는지 먼저 밝힌다 */}
      <section aria-labelledby="basis" className="mt-10">
        <h2 id="basis" className="text-[1.35rem] font-bold tracking-tight text-fg">
          집계의 바탕
        </h2>
        <p className="mt-2 leading-relaxed text-fg-muted">
          축마다 원문에 적혀 있는 정도가 다릅니다. 라벨이 붙은 만큼만 셀 수 있으므로
          축별 모집단을 먼저 밝힙니다.
        </p>

        <dl className="mt-4 space-y-3">
          <Basis label="전체 사례" n={m.corpus} of={m.corpus} note="구조화해 적재한 조정례" />
          <Basis
            label="판매채널이 적힌 사례"
            n={m.labelled}
            of={m.corpus}
            note="채널이 없는 사례는 채널 집계에서 제외합니다. 「미상」이라는 채널을 만들지 않습니다"
          />
          <Basis
            label="소비자 특성이 적힌 사례"
            n={t.labelled}
            of={t.corpus}
            note="특성은 결정문의 「위원회 판단」 부분에만 드러나는 경우가 많아 부착률이 낮습니다"
          />
        </dl>
      </section>

      <nav aria-label="지표" className="mt-10 grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex flex-col rounded-xl border-2 border-border px-5 py-4 no-underline"
          >
            <span className="text-[1.15rem] font-bold text-navy">{c.title} ›</span>
            <span className="mt-1 leading-relaxed text-fg-muted">{c.sub}</span>
          </Link>
        ))}
      </nav>

      <NoCompanyNotice />

      <p className="mt-8 leading-relaxed text-fg-muted">
        이 지표가 어떤 자료에서 나왔는지는{" "}
        <Link href="/verification" className="text-accent underline">
          검증 결과
        </Link>
        에서 함께 공개하고 있습니다.
      </p>
    </div>
  );
}

function Basis({
  label,
  n,
  of,
  note,
}: {
  label: string;
  n: number;
  of: number;
  note: string;
}) {
  const pct = of === 0 ? 0 : Math.round((n / of) * 100);
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <dt className="font-bold text-fg">
        {label} — {n}건{" "}
        {n !== of && <span className="text-fg-muted">(전체의 {pct}%)</span>}
      </dt>
      <dd className="mt-1 leading-relaxed text-fg-muted">{note}</dd>
    </div>
  );
}
