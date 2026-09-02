/**
 * S-01 랜딩 (SR-201 · F-101).
 *
 * 목적은 하나다 — **10초 안에 두 진입점 중 하나를 고르게 한다.**
 *
 * 두 버튼은 시각적으로 동급이다. 예방과 판단 어느 쪽도 우선하지 않는다
 * (화면 명세 G-4 「주 행동 버튼 1개」의 예외를 이 화면에 한해 허용).
 *
 * 금지: 로그인·회원가입 유도 요소(SR-X06) · 광고(SR-X05).
 * 이 파일에 인증 관련 요소가 생기면 그 자체로 범위 위반이다.
 */

import Link from "next/link";
import { CORPUS_SIZE } from "@/lib/types";

/** 진입 버튼 — 두 개가 같은 크기·같은 위계를 갖는다. 아이콘도 중립적 도형만 쓴다 */
function EntryButton({
  href,
  label,
  sub,
  icon,
}: {
  href: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl bg-gradient-to-b from-accent to-accent-deep px-5 py-5 text-accent-fg no-underline shadow-lg shadow-accent/20 transition-transform hover:-translate-y-0.5"
    >
      {/* 아이콘을 왼쪽에 눕힌다 — 세로 배치는 카드가 높아져 두 번째 진입점이
          첫 화면(375×812) 밖으로 밀렸다. S-01의 목적이 「10초 안에 두 진입점
          중 하나를 고르게 한다」인데 하나가 폴드 아래면 목적이 깨진다 */}
      <span aria-hidden="true" className="shrink-0 opacity-90">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[1.25rem] font-bold leading-snug">
          {label}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 4.5 12.5 10 7 15.5" />
          </svg>
        </span>
        <span className="mt-1 block leading-relaxed opacity-95">{sub}</span>
      </span>
    </Link>
  );
}

const entryIcon = {
  // 돋보기 — 가입 전 확인
  check: (
    <svg viewBox="0 0 28 28" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12.5" cy="12.5" r="7.5" />
      <path d="m18.5 18.5 5 5" />
    </svg>
  ),
  // 말풍선 — 상담
  consult: (
    <svg viewBox="0 0 28 28" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6.5h20v13H13l-5.5 4.5v-4.5H4v-13Z" />
      <path d="M9 11.5h10M9 15h6" />
    </svg>
  ),
} as const;

/**
 * S-01 필수 구성인 「하는 일 / 하지 않는 일 요약」.
 *
 * 명세가 이름을 대는 내용은 **법률 자문 아님 · 무료 · 저장 안 함** 셋뿐인데
 * 항목이 8개까지 불어나 있었다. 그중 절반은 같은 화면의 다른 자리(상단 배지 ·
 * 글로벌 푸터)가 이미 하던 말이라, 이용자는 같은 문장을 두 번 읽고 있었다.
 *
 * `items`가 문자열이 아니라 노드인 것은 링크 때문이다 — 아래에 따로 서 있던
 * 검증 결과 안내 문단을 항목 안으로 접어 넣는다.
 */
function PointList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "do" | "dont";
  items: React.ReactNode[];
}) {
  return (
    <section className="rounded-2xl border border-border bg-bg px-5 py-5 shadow-sm">
      <h2
        className={`text-[1.15rem] font-bold ${
          tone === "do" ? "text-fg" : "text-warn-fg"
        }`}
      >
        {title}
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((t, i) => (
          // 고정 목록이라 순서가 바뀌지 않는다 — 노드에는 쓸 키가 없다
          <li key={i} className="flex gap-2 leading-relaxed">
            <span
              aria-hidden="true"
              className={`font-bold ${tone === "do" ? "text-ok-fg" : "text-warn-fg"}`}
            >
              {tone === "do" ? "✓" : "×"}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[0.95rem] font-bold text-accent">
          금융감독원 공개 조정례 {CORPUS_SIZE}건 기반 · 무료
        </p>
        {/* 제목이 한쪽 축으로 기울면 다른 쪽 사용자가 자기 얘기로 읽지 않는다.
            두 진입점이 동급이라는 원칙(S-01 비고)은 버튼 크기만이 아니라 문구에도 적용된다. */}
        <h1 className="mt-3 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
          금융상품, 가입 전에도 문제가 생긴 뒤에도
        </h1>
        {/*
          서비스 한 줄 정의 — 범위 문서 2장.

          **「알려드리고 … 알려드립니다」로 쓰지 않는다 (2026.09.01 교체).**
          그 문장은 이 서비스를 «찾아서 전달하는 것»으로 요약했고, 그러면 이용자가
          직접 검색하는 것과 무엇이 다른지가 사라진다. 실제로 다른 지점은 결정서를
          **채널·상품·쟁점으로 분류해 두었다**는 데 있다 — 그 라벨이
          있어야 「내 조건에서 무엇이 다퉈졌는지」를 셀 수 있고, 그 교차 집계는
          어디에도 공개돼 있지 않아 검색으로는 도달할 수 없다.

          수치는 여기 걸지 않는다 — 정확도·커버리지는 n·신뢰구간·회차를 병기해야
          하고(검증 수치 병기 원칙), 그 병기를 못 지킬 자리에는 걸지 않는다.
          성능 수치의 자리는 S-06이다.

          **길이가 이 문단의 제약이다.** 더 길게 쓴 첫 판은 375×812에서 둘째 진입
          버튼을 822px로 밀어 폴드 아래로 내려보냈다 — 위 `EntryButton`이 경고하는
          바로 그 상태다. 지금 문안(105자)에서 둘째 버튼 하단이 789px이므로 **남은
          여유는 23px뿐**이고, 모바일에서 한 줄이 30px다. 즉 **한 줄만 더 늘어도
          목적이 깨진다.** 내용을 더 넣고 싶으면 이 문단이 아니라 다른 자리를 찾고,
          고칠 때는 375×812에서 둘째 버튼 하단을 반드시 다시 잰다.

          **「사건마다 읽어 … 붙여 두었다」로 쓰지 않는다 (2026.09.01).** 부착률이
          축마다 다르다 — 388건 중 channel 125 · traits 39 · compensation_rate 35
          (`docs/10-db.md` v20260830-r03). 「사건마다」는 전수로 읽히고, 그러면
          코퍼스 배지가 360에 멈춰 있던 것(2026.08.31 수정)과 같은 종류의 어긋남이
          된다. 라벨은 `label_source='MODEL'`이라 「읽어 붙였다」도 사람이 검수한
          것처럼 읽히는데, 아래 카드가 「AI가 지어낸 문장은 나올 수 없습니다」를
          말하고 있어 그 인상이 더 강해진다. **「분류해 두었다」는 전수도 사람
          검수도 주장하지 않으면서** 차별점(분류돼 있어 셀 수 있다)은 그대로 남긴다.
        */}
        <p className="mt-4 text-[1.15rem] leading-relaxed text-fg-muted">
          금융감독원 분쟁조정 결정서를 채널·상품·쟁점으로 분류해 두었습니다.
          가입 전에는 내 조건에서 무엇이 다퉈졌는지 세어 드리고, 문제가 생긴
          뒤에는 그 선례와 법령에 비추어 성립 가능성을 알려드립니다.
        </p>
      </header>

      {/* 진입 버튼 2개 — 시각적 동급 */}
      <nav aria-label="시작하기" className="mt-8 grid gap-4 sm:grid-cols-2">
        <EntryButton
          href="/precheck"
          label="가입 전에 확인하기"
          sub="이 상품에서 어떤 분쟁이 많았는지 봅니다"
          icon={entryIcon.check}
        />
        <EntryButton
          href="/consult"
          label="이미 문제가 생겼어요"
          sub="내 사건이 분쟁조정에 해당하는지 봅니다"
          icon={entryIcon.consult}
        />
      </nav>

      {/*
        상담을 거치지 않고 결과물부터 보고 싶은 사람을 위한 길.

        판단은 자료를 하나씩 확인하느라 2분쯤 걸린다. 그 시간을 쓰기 전에
        「무엇이 나오는지」부터 보고 싶은 사람이 있고, **심사·시연처럼 기다릴
        수 없는 상황**도 있다. 데모 3종은 배포 번들의 정적 자산이라(F-701)
        모델·DB·외부 API를 하나도 부르지 않고 즉시 열린다.

        진입 카드 2개(G-4 예외로 허용된 동급 CTA)보다 위계를 낮춰 셋째 선택지가
        되지 않게 한다 — 테두리 없는 링크 한 줄이다.
      */}
      <p className="mt-5 leading-relaxed">
        <Link href="/demo" className="inline-flex items-center gap-1 text-accent underline">
          먼저 어떤 결과가 나오는지 둘러보기
        </Link>
        <span className="text-fg-muted"> — 실제 분쟁 사례로 미리 돌려 둔 결과 3가지</span>
      </p>

      {/* 하는 일 / 하지 않는 일 */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <PointList
          title="이 서비스가 하는 일"
          tone="do"
          items={[
            // 절대 규칙 1(환각 방지)을 이용자의 말로 옮긴 항목이다. 「찾아서
            // 보여준다」만 적으면 검색과 구별되지 않는데, 실제로 다른 것은
            // **지어낸 문장이 나올 경로가 없다**는 쪽이다.
            "화면에 나오는 사례·조문은 전부 실제로 찾아온 것입니다. AI가 지어낸 문장은 나올 수 없습니다",
            "판단의 확신이 부족하면 결론을 내지 않고 무엇이 더 필요한지 알려드립니다",
            // 「무엇을 확인하지 못했는지」만으로는 남들도 하는 말로 읽힌다.
            // 실제로 드문 것은 **틀린 곳과 흔들리는 폭까지 잰다**는 쪽이라
            // 그 둘을 항목이 직접 말한다. 수치는 걸지 않는다 — 병기 원칙을
            // 지킬 수 있는 자리가 S-06이다.
            <>
              얼마나 맞히는지, 어디서 틀렸는지까지{" "}
              <Link href="/verification" className="text-accent underline">
                검증 결과
              </Link>
              에 그대로 공개합니다 — 같은 사건을 두 번 재서 흔들리는 폭까지 싣습니다
            </>,
          ]}
        />
        <PointList
          title="이 서비스가 하지 않는 일"
          tone="dont"
          items={[
            "법률 자문이 아닙니다. 서류를 대신 쓰거나 변호사를 연결해 드리지 않습니다",
            "특정 금융회사를 평가하지 않습니다",
            "회원가입이 없고, 상담 내용을 저장하지 않습니다. 창을 닫으면 사라집니다",
          ]}
        />
      </div>
    </div>
  );
}
