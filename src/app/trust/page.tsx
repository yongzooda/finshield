/**
 * Trust Center (S-018).
 *
 * 이 서비스가 무엇을 하고 무엇을 하지 않는지, 지금 무엇이 검증됐고 무엇이
 * 검증되지 않았는지 공개한다. 검증되지 않은 것을 검증된 것처럼 적지 않는다.
 */

import type { Metadata } from "next";
import { FsCard, FsChip, FsShell } from "../fs-shell";

export const metadata: Metadata = { title: "무엇이 검증됐는지 | FinShield" };

const VERIFIED = [
  ["모델 응답 형식과 비용", "합성 fixture 50건과 오류 20건을 실제 호출로 쟀습니다."],
  ["Embedding 선택", "후보 모델을 같은 평가셋으로 비교했습니다."],
  ["DB 권한과 교차 소유 거부", "다른 사용자의 자료에 닿지 못하는지 실제 DB 에서 쟀습니다."],
  ["파일 안전성", "암호화·매크로·중첩·polyglot·폭탄 파일을 격리 환경에서 열어 봤습니다."],
  ["공식 출처 Snapshot", "두 공공 API 를 교차 확인하고 해시를 고정했습니다."],
  ["예산과 호출 제한", "같은 상한에 동시 예약 60건을 걸어 초과 승인이 없는지 봤습니다."],
  ["동의 격리", "동의하지 않은 원본이 외부로 나가지 않는지 8가지 상태로 봤습니다."],
  ["저장소 권한", "회원 권한으로 남의 경로에 쓰거나 읽지 못하는지 실제 Storage 에서 봤습니다."],
  ["원본 물리 삭제", "확인·중단·Case 삭제·만료 경계 40건에서 객체가 실제로 사라지는지 봤습니다."],
  ["실행 Runtime", "배포 안에서 실제 Node 판과 지역을 읽어 남겼습니다."],
  ["법제처 접근 조건", "등록 도메인 외의 요청이 막히는지 배포 안에서 확인했습니다."],
];

const NOT_YET = [
  ["한국어 검색 품질", "기준선에 못 미쳐 다시 설계 중입니다."],
  ["OCR 정확도", "한국어 정답 자료를 아직 만들지 않았습니다."],
  ["소비자 경보·약관 자료", "적재하지 않았습니다. 그 항목은 확인하지 못했다고 적습니다."],
  ["Job 재시도와 연결 단절 복원", "구현 중입니다."],
  ["헬스체크 경계", "외부 Provider 를 부르지 않도록 고치는 중입니다."],
  ["종단 시험", "위 항목이 끝난 뒤에 합니다."],
];

export default function TrustPage() {
  return (
    <FsShell>
      <header>
        <p className="fs-eyebrow">Trust Center</p>
        <h1 className="fs-h1 mt-2">무엇이 검증됐고 무엇이 아직인지</h1>
        <p className="fs-lead mt-3 max-w-2xl">
          이 서비스는 아직 출시 전입니다. 검증한 것과 검증하지 않은 것을 나눠 적습니다.
          검증하지 않은 것을 검증된 것처럼 적지 않는 것이 이 페이지의 목적입니다.
        </p>
      </header>

      <FsCard className="mt-8">
        <div className="flex items-center gap-3">
          <FsChip tone="verified">검증함</FsChip>
          <h2 className="fs-h2">저장소 수준 증거로 통과한 항목</h2>
        </div>
        <ul className="mt-4 space-y-3">
          {VERIFIED.map(([title, detail]) => (
            <li key={title}>
              <p className="font-bold">{title}</p>
              <p className="fs-meta">{detail}</p>
            </li>
          ))}
        </ul>
      </FsCard>

      <FsCard>
        <div className="flex items-center gap-3">
          <FsChip tone="caution">아직 아님</FsChip>
          <h2 className="fs-h2">검증하지 않은 항목</h2>
        </div>
        <ul className="mt-4 space-y-3">
          {NOT_YET.map(([title, detail]) => (
            <li key={title}>
              <p className="font-bold">{title}</p>
              <p className="fs-meta">{detail}</p>
            </li>
          ))}
        </ul>
      </FsCard>

      <p className="fs-meta mt-6">
        증거는 저장소에 그대로 있습니다. 각 항목은 실행 기록과 결과 파일과 채택 이력으로
        되짚을 수 있습니다. 통과 여부는 사람의 판단이 아니라 사전에 정해 둔 합격선이 정합니다.
      </p>
    </FsShell>
  );
}
