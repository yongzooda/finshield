/**
 * FinShield 첫 화면 (S-001).
 *
 * 정확도·건수 같은 수치를 걸지 않는다. 수치는 표본과 회차를 함께 적어야 하고
 * 아직 그 근거를 만들지 않았다. PreCase 의 성능을 FinShield 의 성능으로 적지도
 * 않는다 (OPS-002). Release Gate 전이므로 출시 완료로 표시하지 않는다 (규칙 8).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { FsCard, FsShell } from "./fs-shell";

export const metadata: Metadata = {
  title: "FinShield — 거래 전 금융정보 검증",
  description: "권유받은 내용을 공식 자료에 대고 확인하고, 무엇을 근거로 판단했는지 그대로 보여 드립니다.",
};

const SCOPE = [
  { label: "법령·판례", detail: "법제처 공개 API 로 실행할 때마다 조회합니다.", ready: true },
  { label: "상품·기관", detail: "공공데이터 포털에서 받아 둔 공식 자료로 확인합니다.", ready: true },
  { label: "공식 채널", detail: "등록된 번호와 주소에 대고 맞춰 봅니다.", ready: true },
  { label: "소비자 경보·약관", detail: "아직 자료를 넣지 않았습니다. 확인하지 못했다고 적습니다.", ready: false },
];

export default function HomePage() {
  return (
    <FsShell>
      <header>
        <p className="fs-eyebrow">거래 전 금융정보 검증</p>
        <h1 className="fs-h1 mt-2">
          송금하기 전에,
          <br />
          공식 자료로 하나씩 확인합니다
        </h1>
        <p className="fs-lead mt-4 max-w-2xl">
          권유받은 내용에서 확인할 항목을 뽑아 드립니다. 고르신 항목만 법령과 공식 상품 자료와
          공식 채널 등록부에 대고 확인하고, 무엇을 근거로 그렇게 판단했는지 그대로 보여 드립니다.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/verify" className="fs-btn fs-btn--primary">거래 전에 확인하기</Link>
          <Link href="/precase" className="fs-btn fs-btn--quiet">이미 가입했거나 문제가 생겼어요</Link>
        </div>
      </header>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <FsCard>
          <h2 className="fs-h2">하지 않는 것</h2>
          <ul className="fs-body mt-3 space-y-2">
            <li>0에서 100 사이의 안전 점수를 만들지 않습니다.</li>
            <li>근거를 찾지 못한 것을 안전하다고 말하지 않습니다.</li>
            <li>사기나 위법을 단정하지 않습니다.</li>
            <li>가입·송금·투자를 대신 결정하거나 실행하지 않습니다.</li>
          </ul>
        </FsCard>
        <FsCard>
          <h2 className="fs-h2">지키는 것</h2>
          <ul className="fs-body mt-3 space-y-2">
            <li>화면의 판단마다 무엇을 근거로 했는지 붙입니다.</li>
            <li>공식 자료가 엇갈리면 한쪽을 고르지 않고 둘 다 남깁니다.</li>
            <li>확인한 범위와 확인하지 못한 범위를 함께 적습니다.</li>
            <li>올리신 원문은 저장하지 않습니다.</li>
          </ul>
        </FsCard>
      </div>

      <FsCard className="mt-4">
        <h2 className="fs-h2">지금 확인할 수 있는 범위</h2>
        <ul className="mt-4 space-y-3">
          {SCOPE.map((item) => (
            <li key={item.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`fs-chip fs-chip--${item.ready ? "verified" : "neutral"}`}>
                {item.ready ? "사용 가능" : "준비 중"}
              </span>
              <span className="font-bold">{item.label}</span>
              <span className="fs-meta">{item.detail}</span>
            </li>
          ))}
        </ul>
      </FsCard>

      <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
        <Link href="/cases" className="fs-body underline">내 검증 기록</Link>
        <Link href="/profile" className="fs-body underline">금융 프로필</Link>
        <Link href="/trust" className="fs-body underline">무엇이 검증됐는지</Link>
        <Link href="/privacy-center" className="fs-body underline">개인정보 처리</Link>
      </nav>

      <p className="fs-meta mt-6">
        시험 단계이고 아직 출시 전입니다. 실제 개인정보와 실제 금융 서류를 넣지 마세요.
        넣으셔도 저장 전에 가려지지만, 애초에 받지 않는 것이 안전합니다.
      </p>
    </FsShell>
  );
}
