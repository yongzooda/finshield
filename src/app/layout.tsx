import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ServiceNavigation } from "./service-navigation";

export const metadata: Metadata = {
  title: "FinShield — 금융 권유 확인부터 가입 후 보호까지",
  description: "대출 권유를 공식 자료와 비교하고, 검증 기록을 가입 후 점검까지 이어 관리하세요.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <a href="#main-content" className="fs-skip-link">본문 바로가기</a>
        <ServiceNavigation />
        <main id="main-content" className="flex-1" tabIndex={-1}>{children}</main>
        <footer className="fs fs-footer">
          <div className="fs-footer-inner">
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2">
              <span className="font-bold tracking-tight">FinShield</span>
              <nav aria-label="서비스 정보" className="flex flex-wrap gap-x-5">
                <Link href="/trust">신뢰센터</Link>
                <Link href="/privacy-center">개인정보·데이터 관리</Link>
                <Link href="/live-demo">서비스 체험</Link>
              </nav>
            </div>
            <p className="mt-3">금융 거래 판단을 돕는 참고 정보입니다. 금융·법률 자문이나 거래의 안전을 보장하지 않습니다.</p>
            <p className="mt-1">각 판단에 사용한 공식 자료와 확인 범위는 결과의 근거에서 확인할 수 있습니다.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
