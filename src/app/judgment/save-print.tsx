"use client";

/**
 * 결과 저장·인쇄 (S-04 · S-07 「인쇄·저장 친화 레이아웃」).
 *
 * ## 왜 이게 로그인의 자리를 대신하나
 *
 * 「내 기록을 다시 보고 싶다」는 요구는 정당하다. 그런데 그걸 로그인·이력 저장으로
 * 풀면 **판단 결과를 서버에 남겨야 한다** — 저장 금지(DR-4xx · N-403)를 정면으로
 * 어긴다. 이 서비스가 「아무것도 보관하지 않습니다」라고 말할 수 있는 근거가
 * 사라지는 것이다.
 *
 * 그래서 기록은 **이용자 손에 남긴다.** 서버가 아니라 이용자의 기기에 PDF나
 * 종이로 남으므로, 우리는 여전히 아무것도 갖고 있지 않다. 고령 이용자가 금감원
 * 창구에 종이를 들고 갈 수 있다는 점에서 오히려 실용적이다.
 *
 * ## 접힌 것을 펴고 인쇄한다
 *
 * 화면에서 근거 카드를 접어 둔 것은 길이 때문이지 감추려는 게 아니다. 인쇄본에서
 * 접힌 채로 나가면 **한계 항목이 종이에서 사라진다** — 화면 명세가 금지한 것과
 * 같은 결과다. `beforeprint`에서 전부 펴고, 인쇄가 끝나면 원래대로 되돌린다.
 */

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * 인쇄 직전에 ① 접힌 것을 전부 펴고 ② 인쇄 날짜를 채운다. 끝나면 되돌린다.
 *
 * 둘 다 **인쇄 시점의 사실**이라 마운트가 아니라 `beforeprint`에서 정한다.
 * 화면을 열어 둔 채 다음 날 인쇄하면 날짜는 인쇄한 날이어야 맞다. 서버가 모르는
 * 값이므로 첫 렌더에 넣으면 하이드레이션도 어긋난다.
 *
 * 접힌 `<details>`는 CSS로 열 수 없다. `display:block`을 줘도 닫힌 상태의 내용은
 * 브라우저가 그리지 않으므로 열어야 한다. 화면에서 접어 둔 것은 길이 때문이지
 * 감추려는 게 아니어서, **종이에서 사라지면 안 된다.**
 */
function usePrintPrep(): string | null {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    let reclose: HTMLDetailsElement[] = [];

    const open = () => {
      reclose = Array.from(document.querySelectorAll<HTMLDetailsElement>("details:not([open])"));
      for (const d of reclose) d.open = true;
      const d = new Date();
      // `window.print()`는 동기다. 평소처럼 예약된 리렌더는 인쇄가 끝난 뒤에나
      // 반영돼서 종이에 날짜가 빈 채로 나간다. 여기서만 즉시 반영시킨다.
      flushSync(() => {
        setToday(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`);
      });
    };
    const restore = () => {
      for (const d of reclose) d.open = false;
      reclose = [];
    };

    window.addEventListener("beforeprint", open);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", open);
      window.removeEventListener("afterprint", restore);
    };
  }, []);

  return today;
}

export function SavePrint() {
  const today = usePrintPrep();

  return (
    <>
      {/* 종이에만 나오는 머리말 — 언제 뽑은 것인지 알 수 있어야 한다 */}
      <p className="hidden print:block print:mb-4 leading-relaxed text-fg-muted">
        프리케이스 판단 결과{today ? ` · ${today} 인쇄` : ""}
      </p>

      <div className="print:hidden">
        <p className="leading-relaxed text-fg-muted">
          이 결과는 <strong className="text-fg">저장되지 않습니다.</strong> 창을 닫으면
          사라지고, 저희 쪽에도 남지 않습니다. 남겨 두시려면 지금 이 화면을 PDF로
          저장하거나 인쇄해 두세요.
        </p>

        <button
          type="button"
          onClick={() => window.print()}
          className="mt-4 inline-flex min-h-12 items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg"
        >
          이 화면 저장·인쇄하기
        </button>

        <details className="group mt-4 rounded-lg border border-border px-5 py-4">
          <summary className="flex min-h-12 cursor-pointer list-none items-center font-bold text-fg">
            <span aria-hidden="true" className="mr-2 inline-block transition-transform group-open:rotate-90">
              ▶
            </span>
            휴대폰에서 PDF로 저장하는 방법
          </summary>
          <ul className="mt-3 space-y-2 leading-relaxed text-fg-muted">
            <li>
              <strong className="text-fg">아이폰</strong> — 위 버튼을 누르면 인쇄 화면이
              열립니다. 오른쪽 위 「PDF」 또는 공유 버튼을 눌러 「파일에 저장」을 고르세요.
            </li>
            <li>
              <strong className="text-fg">안드로이드</strong> — 위 버튼을 누른 뒤 프린터
              목록에서 <strong className="text-fg">「PDF로 저장」</strong>을 고르세요.
            </li>
            <li>
              접혀 있는 「근거 법령」·「참고 조정례」·「판단 과정」도{" "}
              <strong className="text-fg">펼쳐진 상태로 저장됩니다.</strong> 화면에서 접어 둔
              것은 길이 때문이지 감추려는 것이 아닙니다.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
