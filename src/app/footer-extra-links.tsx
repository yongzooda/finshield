"use client";

/**
 * 랜딩에서만 나오는 부가 링크 — 분쟁 패턴 지표(S-09~12) · MCP 서버.
 *
 * ## 왜 나눴나
 *
 * 글로벌 푸터가 요구하는 링크는 **검증 결과 · 데모 사례 · 개인정보 처리방침**
 * 셋이다 (G-2 · N-504). 이 둘은 명세가 요구하지 않는데도 같은 줄에 같은 모양으로
 * 섞여 있었다. 청중이 다르다 — 기관 지표와 도구 공개는 심사위원·개발자가 보는
 * 것이고, 이용자에게 「MCP 서버」는 개인정보 처리방침과 동급으로 보인다.
 *
 * 심사위원·개발자는 랜딩을 반드시 지난다. T-4의 「어느 화면에서든 도달」은
 * 검증 결과·데모에 걸린 조건이라 이 둘을 랜딩으로 모아도 어긋나지 않는다.
 *
 * 상담(S-03)·판단 화면에서 링크 줄 하나가 사라진다 — 실측 54px.
 *
 * ## 왜 클라이언트인가
 *
 * 경로를 알아야 하는데 루트 레이아웃은 서버 컴포넌트라 경로를 받지 못한다.
 * `headers()`를 쓰면 레이아웃 전체가 동적 렌더링으로 넘어가 **정적 LCP 2.5초**
 * 목표(N-101)가 깨진다. 링크 두 개짜리 클라이언트 경계가 그보다 싸다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FooterExtraLinks() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    // 좁은 화면에서는 감겨서 둘째 줄이 되고, 넓은 화면에서는 `ms-auto`가 오른쪽
    // 끝으로 민다. 어느 폭에서도 필수 링크와 한 덩어리로 읽히지 않게 하려는
    // 것이다 — 실측 960px에서는 다섯 개가 한 줄에 들어가 그냥 두면 구분이 사라졌다
    <span className="flex flex-wrap items-center gap-x-5 sm:ms-auto">
      <Link href="/insight" className="inline-flex items-center text-accent underline">
        분쟁 패턴 지표
      </Link>
      {/* 도구 5종을 외부에 공개한다 — 개발자만 볼 링크라 맨 뒤에 둔다 */}
      <Link href="/mcp" className="inline-flex items-center text-accent underline">
        MCP 서버
      </Link>
    </span>
  );
}
