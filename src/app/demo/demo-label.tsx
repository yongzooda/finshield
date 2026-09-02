/**
 * 「데모 사례입니다」 고정 라벨 (F-701 · 화면 4.3).
 *
 * **최상단 고정**이다. 실제 판단과 혼동되면 안 되는데, 데모는 실제 화면과
 * 똑같이 생겼기 때문이다 — 그것이 데모의 목적이자 위험이다.
 *
 * 접거나 숨기지 않는다. 스크롤해도 따라온다.
 */

export function DemoLabel({ what }: { what: string }) {
  return (
    <>
      {/* 고정되는 것은 짧은 라벨 한 줄이다 — 좁은 화면에서 설명까지 sticky로
          따라오면 본문의 1/4을 계속 가린다(375px 실측 5줄). 구분 목적은 라벨이
          채우고, 어떤 사건인지는 바로 아래 본문(비고정)이 말한다 */}
      <div className="sticky top-0 z-20 border-b-2 border-warn-border bg-warn-bg">
        <p className="mx-auto max-w-3xl px-5 py-2.5 font-bold leading-relaxed text-warn-fg">
          데모 사례입니다 — 실제로 상담하신 결과가 아닙니다
        </p>
      </div>
      <p className="mx-auto max-w-3xl px-5 pt-4 leading-relaxed text-fg-muted">{what}</p>
    </>
  );
}
