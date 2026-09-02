"use client";

/**
 * 화면이 바뀌면 **새 제목으로 포커스를 옮긴다** (A11Y-7).
 *
 * ## 왜 필요한가
 *
 * 이 서비스의 화면 전환은 페이지 이동이 아니라 같은 페이지 안의 상태 변화다
 * (동의 → 진술 → 되묻기 → 완료 → 판단 결과). 눈으로 보는 이용자에게는 화면이
 * 바뀐 것이 명백하지만, **스크린리더 이용자에게는 아무 일도 일어나지 않는다** —
 * 포커스가 이전 화면의 버튼에 그대로 남아 있기 때문이다.
 *
 * 주 사용자가 고령층이라 이 차이가 실제로 사람을 막는다.
 *
 * ## 어떻게
 *
 * 제목에 `tabIndex={-1}`을 주고(키보드 탭 순서에는 넣지 않는다) 상태가 바뀔 때
 * 포커스를 옮긴다. 스크린리더가 새 제목을 읽으면 이용자는 어디로 왔는지 안다.
 * `outline: none`을 주지 않는다 — 포커스 표시는 보이는 편이 낫다.
 */

import { useEffect, useRef } from "react";

export function useFocusOnChange<T>(key: T) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [key]);
  return ref;
}
