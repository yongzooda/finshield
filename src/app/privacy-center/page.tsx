import type { Metadata } from "next";
import { FsCard, FsShell } from "../fs-shell";
import { PrivacyActions } from "./privacy-actions";

export const metadata: Metadata = { title: "개인정보·데이터 관리 | FinShield" };

export default function PrivacyCenterPage() {
  return (
    <FsShell>
      <header><p className="fs-eyebrow">개인정보·데이터 관리</p><h1 className="fs-h1 mt-2">내가 남긴 자료를 관리하세요</h1><p className="fs-lead mt-3">저장되는 내용을 확인하고 검증 기록을 삭제할 수 있습니다.</p></header>
      <p className="fs-inline-notice mt-6">공모전 시험 서비스입니다. 실제 개인정보·금융 서류·실제 금융 프로필은 입력하지 마세요.</p>
      <div className="mt-6"><PrivacyActions /></div>
      <FsCard className="mt-6">
        <h2 className="fs-h2">데이터 처리 안내</h2>
        <dl className="mt-3">
          {[["계정", "이메일과 비밀번호는 인증 서비스에서 처리합니다. 로그인 상태는 현재 브라우저 탭에서 유지됩니다."], ["검증 기록", "개인정보를 가린 문장, 확인 항목, 결과와 근거, 선택한 금융 프로필을 저장합니다."], ["외부 처리", "개인정보 검사 이후의 텍스트와 확인 항목을 AI 모델에 전달합니다. 개인정보가 남아 있다고 판단되면 처리를 중단합니다."], ["보관·삭제", "기록은 삭제 요청 전까지 보관합니다. 삭제를 요청하면 접근을 차단하고 연결된 자료의 정리를 시작합니다."], ["파일 업로드", "이미지·PDF 업로드는 현재 사용자 화면에 제공되지 않습니다."], ["회원 탈퇴", "현재 화면은 개별 검증 기록 삭제와 로그아웃을 지원합니다. 계정 탈퇴 기능은 아직 제공되지 않습니다."]].map(([label, description]) => <div key={label} className="fs-list-row !items-start"><dt className="min-w-24 font-semibold">{label}</dt><dd className="fs-body flex-1">{description}</dd></div>)}
        </dl>
      </FsCard>
    </FsShell>
  );
}
