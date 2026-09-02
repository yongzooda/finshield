"use client";

/**
 * 읽어주기 (R-09) — 판단 결과를 브라우저 내장 음성으로 읽는다.
 *
 * 실기 판정(2026.08.29, 카카오톡 인앱 iOS)으로 채택된 기능이다. 음성 처리는
 * 전부 브라우저 안에서 일어나고 서버·모델은 관여하지 않는다(P-3). 읽는 내용은
 * 화면에 이미 렌더된 문자열 그대로라 새 내용이 생길 자리가 없다.
 *
 * - **미지원 환경에서는 버튼을 그리지 않는다** (R-09 요구). 감지는
 *   `useSyncExternalStore`로 한다 — 서버 렌더에서는 false, 브라우저에서 실제
 *   지원 여부. 마운트 효과에서 setState하는 형태는 린트가 막는다.
 * - 긴 산문은 iOS가 중간에 끊는 일이 있어 **문단 단위로 나눠 큐잉**한다.
 * - 화면을 떠나면 재생을 멈춘다 — 다른 화면에서 목소리가 이어지면 안 된다.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribe = () => () => {};
const supportedNow = () => "speechSynthesis" in window;
const supportedOnServer = () => false;

export function ReadAloud({ chunks, label }: { chunks: string[]; label: string }) {
  const supported = useSyncExternalStore(subscribe, supportedNow, supportedOnServer);
  const [speaking, setSpeaking] = useState(false);
  /** 마지막 문단의 종료만 「끝」으로 친다 — 문단마다 버튼이 깜빡이면 안 된다 */
  const remaining = useRef(0);

  useEffect(() => {
    return () => {
      if (supportedNow()) window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported) return null;

  const stop = () => {
    remaining.current = 0;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const start = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const texts = chunks.map((c) => c.trim()).filter(Boolean);
    if (texts.length === 0) return;

    const korean = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("ko"));
    remaining.current = texts.length;
    setSpeaking(true);

    for (const text of texts) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      if (korean) u.voice = korean;
      const settle = () => {
        remaining.current -= 1;
        if (remaining.current <= 0) setSpeaking(false);
      };
      u.onend = settle;
      // 취소(cancel)도 오류 이벤트로 온다 — 조용히 정리한다
      u.onerror = settle;
      synth.speak(u);
    }
  };

  return (
    <button
      type="button"
      onClick={speaking ? stop : start}
      aria-pressed={speaking}
      className="mt-4 inline-flex min-h-12 items-center rounded-lg border-2 border-border px-5 py-2.5 font-bold text-fg print:hidden"
    >
      {speaking ? "읽기 멈추기" : label}
    </button>
  );
}
