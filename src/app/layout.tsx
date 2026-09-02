import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { FooterExtraLinks } from "./footer-extra-links";

export const metadata: Metadata = {
  title: "프리케이스 — 불완전판매 분쟁 예방·판단",
  description:
    "공개된 금융분쟁조정 선례와 법령을 근거로, 불완전판매 분쟁을 미리 예방하고 성립 가능성을 알려주는 무료 서비스입니다.",
};

/** 브랜드 마크 — 방패 + 확인 표시. 외부 에셋 없이 인라인 SVG 하나로 그린다 */
function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5v-6L12 2.5Z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </svg>
  );
}

/** G-1 글로벌 헤더 — 서비스명만. 메뉴·햄버거를 두지 않는다 (화면 수가 적다) */
function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center px-5">
        <Link
          href="/"
          className="flex items-center gap-2 py-1 text-[1.15rem] font-bold tracking-tight text-navy no-underline"
        >
          <span className="text-accent">
            <BrandMark />
          </span>
          프리케이스
        </Link>
      </div>
    </header>
  );
}

/**
 * G-2 글로벌 푸터 — 면책 고지(F-103) · 검증 결과 링크(S-06) · 데모 사례 링크(F-701) ·
 * **개인정보 처리방침(N-504)** · 출처 표기.
 *
 * **여기 있는 것은 전부 명세가 요구하는 것이다.** 그 밖의 링크는 `FooterExtraLinks`로
 * 빠져 랜딩에서만 나온다 — 이용자용·심사용 링크가 한 줄에 섞이면 「MCP 서버」가
 * 개인정보 처리방침과 동급으로 읽힌다.
 *
 * **문장을 짧게 쓴다.** 실측(375px): 산문 152자가 234px를 먹었고, 상담 화면(S-03)에서는
 * 푸터가 문서 높이의 35%였다. 88자로 줄여 27%가 됐다.
 *
 * **그리고 글자 크기로도 물러난다 (2026.09.01).** 그 전까지는 면책·링크·출처가 전부
 * 본문과 같은 18px여서 위계가 없었고, 푸터가 안내문처럼 읽혔다 — 시중 앱의 푸터는
 * 본문보다 작고 뒤로 물러나 있다. 「A11Y-1로 축소 불가」라고 적혀 있었으나 **그 조항의
 * 범위는 「본문 글자 크기 — 18px 이상(버튼·입력 라벨 포함)」**이고, 푸터의 면책·출처는
 * 그중 어느 것도 아니다. 이 프로젝트는 이미 **실행 로그 17.1px를 「A11Y-1은 본문(body)
 * 기준이라 위반은 아니다」로 판정**했다(`08-nfr.md` 게이트 기록). 같은 기준을 여기 적용한다.
 *
 * **터치 영역은 그대로다** — `globals.css`가 모든 `a`·`button`에 `min-height: 3rem`을
 * 건다. `rem`은 루트(18px) 기준이라 **요소의 글꼴을 줄여도 54px가 유지된다.**
 * A11Y-2는 글자 크기와 독립이다.
 */
function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-bg-subtle">
      <div className="mx-auto max-w-3xl px-5 py-6 text-fg-muted">
        {/* F-103의 취지는 이 두 문장이다. 「분쟁조정 신청 여부는 이용자 본인이
            결정합니다」는 빼도 잃는 것이 없다 — 신청권 명시는 S-04 「다음에 하실 일」이
            1332 안내와 함께 이미 하고 있고(`result-views.tsx`), 거기가 그 문장이
            필요한 자리다. 푸터는 판단을 보여주지 않는 화면에도 붙는다 */}
        <p className="text-[16px] leading-relaxed">
          <strong className="text-fg">법률 자문이 아닙니다.</strong> 공개된 선례와 법령에
          근거한 참고 정보이며, 조정 결과를 예단하지 않습니다.
        </p>
        {/* 종이에서는 누를 수 없다. 면책 문구와 출처는 남긴다 */}
        {/* 「검증 결과 공개」가 아니라 「검증 결과」다 — 라벨이 짧아야 필수 3개가
            375px 화면에서 한 줄에 들어간다. **16px로 낮춘 뒤 실측(375px)**:
            60 + 115 + 60 = 235 + 간격 40 = 275 ≤ 330. 여유가 55px로 늘어
            줄바꿈 위험이 줄었다(18px 시절에는 311 ≤ 330으로 19px였다).
            부가 링크는 감겨 둘째 줄이 되고, 그 줄바꿈이 그대로 그룹 경계가 된다 */}
        {/* **「데모 사례」를 이용자용 링크 뒤로 보낸다 (2026.09.01).** T-4가 데모를
            모든 화면 푸터에 요구하지만 그 조항이 대는 이유는 「**심사위원이** 어느
            화면에서든 도달할 수 있어야 한다」다 — 이용자를 위한 링크가 아니다.
            상담 중인 이용자에게 「데모 사례」가 개인정보 처리방침과 같은 자리·같은
            모양으로 서 있으면 둘이 동급으로 읽힌다. **청중이 다르면 순서로 가른다**는
            것은 2026.09.01에 「MCP 서버」·「분쟁 패턴 지표」에 이미 적용한 판단이고,
            데모는 T-4 때문에 뺄 수 없으니 **빼는 대신 뒤로 보낸다.**
            순서만 바꾸므로 폭 합계는 그대로고 한 줄 배치도 유지된다(위 실측) */}
        {/* **링크는 18px를 유지한다.** 면책·출처는 읽기만 하는 fine print라
            A11Y-1 예외로 뒀지만, 링크는 명세가 「버튼·입력 라벨 포함」으로 이름을
            대서 포함시킨 대상이다 — 누르는 것은 줄이지 않는다 */}
        <nav
          aria-label="서비스 정보"
          className="mt-1 flex flex-wrap items-center gap-x-5 print:hidden"
        >
          <Link href="/verification" className="inline-flex items-center text-accent underline">
            검증 결과
          </Link>
          <Link href="/privacy" className="inline-flex items-center text-accent underline">
            개인정보 처리방침
          </Link>
          <Link href="/demo" className="inline-flex items-center text-accent underline">
            데모 사례
          </Link>
          <FooterExtraLinks />
        </nav>
        {/* G-2가 요구하는 것은 출처 표기(금감원·법제처)다. 「원문은 각 기관 공식
            페이지에서 확인할 수 있습니다」는 근거 카드(S-05)가 링크로 하는 일이라
            여기서는 문장 하나를 더 읽게 만들 뿐이었다 */}
        {/* 출처는 **뺄 수 없다.** 금감원 자료를 쓰는 근거가 「인용」이고(기획서 5.1
            「이용 근거와 지키는 선」), 인용은 출처 명시가 요건이다. 공모전 유의사항도
            데이터 무단 사용을 심사 제외·수상 취소 사유로 든다.
            **대신 fine print의 자리로 보낸다** — 가는 선 위, 가장 작은 글자. 시중 앱이
            저작권·귀속 표기를 두는 자리와 같다 */}
        <p className="mt-4 border-t border-border pt-4 text-[15px] leading-relaxed">
          출처 — 금융감독원 「금융소비자의 소리」·「분쟁조정사례」, 법제처 국가법령정보
          공동활용
        </p>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
