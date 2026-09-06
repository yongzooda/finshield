import type { Metadata } from "next";
import Link from "next/link";
import { FsShell } from "./fs-shell";
import { FsIcon } from "./fs-icon";

export const metadata: Metadata = { title: "FinShield — 금융 권유 확인부터 가입 후 보호까지" };

export default function HomePage() {
  return (
    <FsShell wide>
      <section className="fs-hero" aria-labelledby="home-title">
        <div className="fs-hero-copy">
          <p className="fs-eyebrow"><span className="fs-dot" /> 내 금융을 지키는 확인 습관</p>
          <h1 id="home-title">돈을 보내기 전,<br />한 번 더 확인하세요.</h1>
          <p className="fs-lead mt-5">대출 권유 속 금리와 조건을 공식 자료와 비교하고,<br className="hidden lg:block" /> 확인한 기록을 가입 후에도 이어 관리하세요.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/verify" className="fs-btn fs-btn--primary">대출 권유 확인하기 <FsIcon name="arrow" /></Link>
            <Link href="/live-demo" className="fs-btn fs-btn--quiet">로그인 없이 체험</Link>
          </div>
          <p className="fs-meta mt-4">현재 지원: 햇살론15 관련 권유 · 텍스트 입력</p>
        </div>
        <div className="fs-hero-visual" aria-label="금융 권유 확인 과정 안내">
          <div className="fs-message-preview">
            <div className="flex items-center gap-3"><span className="fs-icon-tile"><FsIcon name="document" /></span><span className="font-bold">이런 문자를 받으셨나요?</span></div>
            <p className="mt-4">정부지원 대출 승인 대상입니다.<br /><mark>낮은 고정금리</mark>로 당일 입금 가능하며,<br /><mark>오늘 안에 신청</mark>해 주세요.</p>
            <span className="fs-meta mt-3 block">서비스 이해를 위한 가상 권유문</span>
          </div>
          <div className="fs-review-preview">
            <p className="fs-eyebrow">확인할 항목</p>
            {[["상품 조건", "공식 금리·한도와 비교"], ["권유 경로", "공식 기관·채널과 대조"], ["요구 사항", "송금·설치 요구 확인"]].map(([label, detail]) => (
              <div className="fs-preview-row" key={label}><span>{label}</span><span>{detail}</span><FsIcon name="search" /></div>
            ))}
          </div>
        </div>
      </section>
      <section className="fs-home-services" aria-labelledby="services-title">
        <div className="fs-section-heading"><h2 id="services-title" className="fs-h2">필요한 순간마다, FinShield</h2><Link href="/trust" className="fs-text-link">지원 범위 확인 <FsIcon name="arrow" /></Link></div>
        <div className="fs-service-grid">
          <Link href="/verify" className="fs-service-card"><span className="fs-icon-tile"><FsIcon name="search" /></span><h3>새로운 권유 확인</h3><p>받은 내용을 붙여 넣고<br />조건과 근거를 확인하세요.</p><span className="fs-service-link">새 검증 <FsIcon name="arrow" /></span></Link>
          <Link href="/cases" className="fs-service-card"><span className="fs-icon-tile"><FsIcon name="folder" /></span><h3>내 검증 기록</h3><p>이전 판단과 근거를 다시 보고<br />최신 결과와 비교하세요.</p><span className="fs-service-link">기록 보기 <FsIcon name="arrow" /></span></Link>
          <Link href="/precase" className="fs-service-card"><span className="fs-icon-tile fs-icon-tile--mint"><FsIcon name="shield" /></span><h3>가입 후에도 보호</h3><p>들은 설명과 계약 조건이<br />다르다면 이어서 점검하세요.</p><span className="fs-service-link">가입 후 점검 <FsIcon name="arrow" /></span></Link>
        </div>
      </section>
      <aside className="fs-service-notice"><FsIcon name="shield" /><p><strong>공모전 시험 서비스</strong><span>가상의 자료로 이용해 주세요. 실제 개인정보와 금융 서류는 입력할 수 없습니다.</span></p><Link href="/privacy-center">처리 기준</Link></aside>
    </FsShell>
  );
}
