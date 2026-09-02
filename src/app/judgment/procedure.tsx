/**
 * 분쟁조정 절차·자료 확보 안내 (SR-204 확장 · R-07 ②).
 *
 * 유보든 결론이든 **다음에 무엇을 할 수 있는지**를 절차로 보여준다. 판단
 * 결과가 「가능성 낮음」이어도 신청권은 이용자에게 있으므로(기획서 9.5 ①)
 * 이 섹션은 결과와 무관하게 같은 내용을 보인다.
 *
 * **문장은 코드 상수, 법적 근거는 도구 반환 원문**이다 (`lib/procedure.ts`).
 * 조회에 실패한 조문은 그 자리가 비고, 자료 열람 요구권 문단은 **근거 조문이
 * 없으면 아예 렌더되지 않는다** — 권리 주장을 도구 반환값에 종속시키는
 * 것이 절대 규칙 1의 이 화면 판이다.
 *
 * S-05 진입(`onOpen`)을 두지 않는다. 근거 상세는 **판단 근거**를 펼치는
 * 자리이고, 절차 조문은 판단에 쓰인 근거가 아니다 — 같은 자리에 섞으면
 * 「무엇을 근거로 판단했는가」가 흐려진다.
 */

import { StatuteCitation } from "./evidence-views";
import {
  DOCUMENT_ACCESS_LEAD,
  PROCEDURE_STEPS,
} from "@/lib/procedure";
import type { LookupStatuteResult } from "@/lib/tools/lookup_statute";

/** 자료 열람 요구권의 근거 조문 — 이것이 없으면 권리 문단을 싣지 않는다 */
const ACCESS_ARTICLE = "제28조";

export function ProcedureGuide({
  statutes,
}: {
  /** `lookup_statute`가 반환한 조문. 빈 배열이면 조문 카드가 없는 채로 렌더된다 */
  statutes: readonly LookupStatuteResult[];
}) {
  const access = statutes.find((s) => s.articleNo === ACCESS_ARTICLE);
  const flow = statutes.filter((s) => s.articleNo !== ACCESS_ARTICLE);

  return (
    <div>
      <ol className="space-y-3">
        {PROCEDURE_STEPS.map((s, i) => (
          <li key={s.title} className="rounded-md border border-border px-4 py-4">
            <p className="text-[1.05rem] font-bold text-fg">
              {/* 번호는 순서 표시일 뿐이라 스크린리더에는 목록 구조로 충분하다 */}
              <span aria-hidden="true" className="mr-2 text-fg-muted">
                {i + 1}
              </span>
              {s.title}
            </p>
            <p className="mt-2 leading-relaxed text-fg-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      {flow.length > 0 && (
        <>
          <p className="mt-6 font-bold text-fg">절차의 근거 조문</p>
          <ul className="mt-2 space-y-3">
            {flow.map((s) => (
              <StatuteCitation key={`${s.lawName}${s.articleNo}`} statute={s} />
            ))}
          </ul>
        </>
      )}

      {/* 권리 문단은 근거 조문과 한 몸이다 — 조문이 없으면 주장도 없다 */}
      {access && (
        <>
          <p className="mt-8 font-bold text-fg">자료를 구하는 방법</p>
          <p className="mt-2 leading-relaxed text-fg-muted">{DOCUMENT_ACCESS_LEAD}</p>
          <ul className="mt-3 space-y-3">
            <StatuteCitation statute={access} />
          </ul>
        </>
      )}
    </div>
  );
}
