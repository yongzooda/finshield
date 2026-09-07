import type { Metadata } from "next";
import Link from "next/link";
import { FsCard, FsChip, FsShell } from "../fs-shell";

export const metadata: Metadata = { title: "신뢰센터 | FinShield" };

// ADR-001 metadata·14.2 기준. 과거 시험 이력을 현재 버전의 통과로 표시하지 않는다.
const CONNECTED = ["텍스트·이미지·PDF 입력과 별도 동의 OCR", "항목 확인·근거 여권·재검증", "같은 Case의 가입 후 문서 점검", "회원 탈퇴·세션 갱신·자료 삭제"];
const ACCEPTED = ["생성 모델의 응답 형식·비용", "임베딩 1차 후보 검색", "파일 안전성 격리 시험", "법제처 접근 조건", "공식 상품·취급기관 자료", "실행 환경"];
const PENDING = ["OCR 정식 인식 품질", "공식 지식 자료 적재와 결합 검색 품질", "개인 적합성의 실질적인 판단", "배포 장애·취소·복구 20종", "제공자 개인정보 운영 계약", "정상 복수 항목 판단 품질", "전체 이용 과정과 출시 검증"];

export default function TrustPage() {
  return (
    <FsShell>
      <header><p className="fs-eyebrow">신뢰센터</p><h1 className="fs-h1 mt-2">어디까지 확인할 수 있나요?</h1><p className="fs-lead mt-3">지원 범위와 검증 상태를 공개합니다. 확인하지 못한 내용은 결과에 따로 표시합니다.</p></header>
      <FsCard className="mt-7">
        <div className="flex flex-wrap items-center gap-3"><h2 className="fs-h2">현재 서비스 범위</h2><FsChip tone="caution">시험 운영</FsChip></div>
        <dl className="mt-4">
          {[["지원 대상", "햇살론15라고 주장하거나 사칭하는 대출 권유"], ["입력 방법", "회원은 텍스트·합성 이미지·PDF 입력, 비회원은 준비된 가상 문자 체험"], ["주요 확인 자료", "연결된 공식 상품·취급기관·채널과 법령 조회. 자료 범위가 부족하면 확인 못 함으로 표시"], ["이용 자료", "공모전 시험용 합성 자료만 사용. 실제 개인정보·금융 서류 입력 금지"]].map(([title, detail]) => <div key={title} className="fs-list-row !items-start"><dt className="min-w-24 font-semibold">{title}</dt><dd className="fs-body flex-1">{detail}</dd></div>)}
        </dl>
      </FsCard>
      <FsCard>
        <h2 className="fs-h2">현재 연결된 흐름</h2>
        <ul className="fs-body mt-4 grid gap-2 sm:grid-cols-2">{CONNECTED.map(item=><li key={item}>· {item}</li>)}</ul>
        <p className="fs-meta mt-3">연결됐다는 표시는 정식 품질 관문이나 출시 검증을 통과했다는 뜻이 아닙니다.</p>
      </FsCard>
      <FsCard>
        <h2 className="fs-h2">결과를 읽을 때</h2>
        <div className="mt-4 space-y-4">
          <div><h3 className="font-semibold">항목별 근거 확인</h3><p className="fs-body mt-1">맞는 내용과 다른 내용을 각각 표시합니다. 상품이 존재하더라도 권유자의 신원까지 확인된 것은 아닙니다.</p></div>
          <div><h3 className="font-semibold">미확인과 충돌도 결과에 포함</h3><p className="fs-body mt-1">자료가 부족하거나 공식 출처가 엇갈리면 판단을 보류합니다. 위험 신호를 찾지 못했다는 것이 안전을 보장하지는 않습니다.</p></div>
          <div><h3 className="font-semibold">조회 시점과 자료의 범위</h3><p className="fs-body mt-1">저장된 공식 자료와 실행 시 조회한 자료를 구분합니다. 적용한 근거와 한계는 각 결과에서 확인하세요.</p></div>
        </div>
      </FsCard>
      <FsCard>
        <div className="flex flex-wrap items-center gap-3"><h2 className="fs-h2">아직 완료되지 않은 기능</h2><FsChip tone="neutral">출시 검증 전</FsChip></div>
        <ul className="fs-body mt-4 grid gap-2 sm:grid-cols-2">{PENDING.map(item=><li key={item}>· {item}</li>)}</ul>
        <details className="fs-details"><summary>기술 검증 현황 · 2026.09.08 기준</summary>
          <p className="fs-meta mt-2">현재 코드 버전의 구현 게이트는 NO-GO, 출시 게이트는 NOT-EVALUATED입니다. 아래는 구성요소별 채택 이력이며 서비스 전체의 정확도나 출시 완료를 뜻하지 않습니다.</p>
          <ul className="fs-meta mt-3 space-y-1">{ACCEPTED.map(item=><li key={item}>· {item}: 채택된 시험 증거 있음</li>)}</ul>
          <p className="fs-meta mt-3">최신 기능 변경 뒤 DB 권한·동의·저장소·삭제·호출 제한 증거는 재측정이 필요합니다. 시험 증거는 저장소에서 관리하며 외부 기관의 독립 인증이 아닙니다.</p>
        </details>
      </FsCard>
      <Link href="/privacy-center" className="fs-text-link mt-4">개인정보와 데이터 처리 기준 보기 →</Link>
    </FsShell>
  );
}
