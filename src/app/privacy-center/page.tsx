/**
 * 개인정보 안내 (S-017).
 *
 * 무엇을 저장하고 무엇을 저장하지 않는지, 언제 지우는지 적는다. 약속을 말로만
 * 하지 않고 어디에서 기술적으로 강제되는지 함께 적는다.
 */

import type { Metadata } from "next";
import { FsCard, FsChip, FsShell } from "../fs-shell";

export const metadata: Metadata = { title: "개인정보 처리 | FinShield" };

const KEEP = [
  ["가려진 문장", "PII Gate 를 지난 뒤의 문장만 남습니다. 확인한 항목을 다시 보여 드리려면 필요합니다."],
  ["확인할 항목과 결과", "무엇을 확인했고 무엇을 근거로 했는지가 남습니다."],
  ["실행 기록", "어떤 Agent 가 어떤 자료를 언제 조회했는지가 남습니다."],
];

const NEVER = [
  ["올리신 원문", "저장하지 않습니다. 크기만 기록합니다."],
  ["주민등록번호·계좌번호·연락처", "저장 전에 가려집니다. 가려지지 않은 의심이 남으면 접수 자체를 멈춥니다."],
  ["원본 파일", "확인·중단·삭제 중 가장 먼저 온 시점에 지우고, 어떤 경우에도 24시간을 넘기지 않습니다."],
];

export default function PrivacyCenterPage() {
  return (
    <FsShell>
      <header>
        <p className="fs-eyebrow">개인정보 처리</p>
        <h1 className="fs-h1 mt-2">무엇을 남기고 무엇을 남기지 않는지</h1>
        <p className="fs-lead mt-3 max-w-2xl">
          이 서비스는 시험 단계라 실제 개인정보를 처리하지 않는 것을 전제로 만들어졌습니다.
          그 전제를 말로만 두지 않고 코드와 데이터베이스에서 막습니다.
        </p>
      </header>

      <FsCard className="mt-8">
        <div className="flex items-center gap-3">
          <FsChip tone="neutral">남깁니다</FsChip>
          <h2 className="fs-h2">저장하는 것</h2>
        </div>
        <ul className="mt-4 space-y-3">
          {KEEP.map(([title, detail]) => (
            <li key={title}><p className="font-bold">{title}</p><p className="fs-meta">{detail}</p></li>
          ))}
        </ul>
      </FsCard>

      <FsCard>
        <div className="flex items-center gap-3">
          <FsChip tone="verified">남기지 않습니다</FsChip>
          <h2 className="fs-h2">저장하지 않는 것</h2>
        </div>
        <ul className="mt-4 space-y-3">
          {NEVER.map(([title, detail]) => (
            <li key={title}><p className="font-bold">{title}</p><p className="fs-meta">{detail}</p></li>
          ))}
        </ul>
      </FsCard>

      <FsCard>
        <h2 className="fs-h2">어디에서 강제되는가</h2>
        <ul className="fs-body mt-3 space-y-2">
          <li>가리기는 모델을 거치지 않는 규칙 기반 관문이 먼저 합니다. 통과하지 못하면 원문은 어디로도 가지 않습니다.</li>
          <li>사용자 표는 데이터베이스 정책이 소유자별로 나눠 둡니다. 서버가 실수해도 남의 자료에 닿지 못합니다.</li>
          <li>삭제 성공은 객체가 실제로 사라진 것을 다시 조회해 확인한 뒤에만 기록됩니다.</li>
          <li>이 세 가지는 저장소 수준 증거로 측정해 두었습니다.</li>
        </ul>
      </FsCard>
    </FsShell>
  );
}
