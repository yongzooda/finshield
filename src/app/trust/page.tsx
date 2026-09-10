import type { Metadata } from "next";
import Link from "next/link";
import { FsCard, FsChip, FsShell } from "../fs-shell";
import { readGateStatus, type GateRow } from "@/lib/finshield/gate-status";
import { BLOCKER_LABEL } from "./blocker-labels";

export const metadata: Metadata = { title: "신뢰센터 | FinShield" };
// 빌드할 때 ADR 과 증거 index 를 읽어 만든다. 채택 PR 이 병합되면 다음 배포에 반영된다.
export const dynamic = "force-static";

const CONNECTED = ["텍스트·이미지·PDF 입력과 별도 동의 OCR", "항목 확인·근거 여권·재검증", "같은 기록의 가입 후 문서 점검", "회원 탈퇴·세션 갱신·자료 삭제"];

const labelOf = (row: GateRow) => BLOCKER_LABEL[row.id] ?? row.id;
const kstDate = (iso: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(iso)).replace(/\s/g, "").replace(/\.$/, "");

export default function TrustPage() {
  const gate = readGateStatus();
  const passed = gate.implementationBlockers.filter((row) => row.status === "PASS");
  const failed = gate.implementationBlockers.filter((row) => row.status === "FAIL");
  const pending = gate.implementationBlockers.filter((row) => row.status !== "PASS" && row.status !== "FAIL");
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
        <ul className="fs-body mt-4 grid gap-2 sm:grid-cols-2">
          {[...failed, ...pending].map((row) => <li key={row.id}>· {labelOf(row)}{row.status === "FAIL" ? " (기준 미달, 다시 준비 중)" : ""}</li>)}
          <li>· 개인 적합성의 실질적인 판단</li>
          {gate.releaseBlockers.filter((row) => row.status !== "PASS").map((row) => <li key={row.id}>· {labelOf(row)}</li>)}
        </ul>
        <details className="fs-details"><summary>기술 검증 현황{gate.lastAdoptedAt ? ` · ${kstDate(gate.lastAdoptedAt)} 채택 기준` : ""}</summary>
          <p className="fs-meta mt-2">
            현재 코드 버전의 구현 게이트는 {gate.implementationGate}, 출시 게이트는 {gate.releaseGate}입니다.
            구성요소 시험 {gate.implementationBlockers.length}개 중 {passed.length}개가 채택 기준을 통과했습니다.
            아래는 구성요소별 채택 현황이며 서비스 전체의 정확도나 출시 완료를 뜻하지 않습니다.
          </p>
          <ul className="fs-meta mt-3 space-y-1">{passed.map((row) => <li key={row.id}>· {labelOf(row)}: 채택된 시험 증거 있음</li>)}</ul>
          <p className="fs-meta mt-3">시험 증거는 저장소에서 관리하며 외부 기관의 독립 인증이 아닙니다.</p>
        </details>
      </FsCard>
      <Link href="/privacy-center" className="fs-text-link mt-4">개인정보와 데이터 처리 기준 보기 →</Link>
    </FsShell>
  );
}
