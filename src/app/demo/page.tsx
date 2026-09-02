/**
 * 데모 3종 목록 (DR-107 · F-701).
 *
 * **외부 API·모델·DB 없이 열려야 한다.** 화면 데이터가 배포 번들에 정적 자산으로
 * 들어 있어서(`src/lib/demo/*.ts`) 조회가 하나도 일어나지 않는다 — 심사 중에
 * 법제처가 죽든 크레딧이 떨어지든 이 경로는 산다 (예외처리 8장).
 *
 * 시나리오 C(요건 미달)는 데모에 없다 — 심사위원이 라이브 상담으로 직접 확인할
 * 수 있기 때문이다(로그인 없는 전면 공개, PR-2).
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "데모 사례 — 프리케이스",
  description: "실제로 판단한 결과를 미리 보실 수 있습니다. 상담 없이 바로 열립니다.",
};

const DEMOS = [
  {
    href: "/demo/prevention",
    eyebrow: "가입 직후",
    title: "이 조합에서 확인하실 것",
    detail: "홈쇼핑으로 저축성보험에 가입한 63세. 지금 무엇을 묻고 챙겨야 하는지, 그 근거가 된 분쟁까지.",
  },
  {
    href: "/demo/judgment",
    eyebrow: "판단 — 결론",
    title: "위반 가능성이 인정된 사건",
    detail: "은행 창구에서 ELS에 가입했다가 손실을 본 사건. 근거 법령과 참고 조정례까지.",
  },
  {
    href: "/demo/withheld",
    eyebrow: "판단 — 유보",
    title: "결론을 내지 않은 사건",
    detail: "약관 해석이 쟁점인데 자료가 부족한 경우. 유보가 실패가 아닌 이유.",
  },
] as const;

export default function DemoIndexPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">데모 사례</h1>
      <p className="mt-3 leading-relaxed text-fg-muted">
        프리케이스가 실제로 어떻게 답하는지 미리 보실 수 있습니다. 상담을 시작하지 않아도
        되고, 아래 세 가지는 <strong className="text-fg">실제로 판단을 돌려 나온 결과</strong>를
        그대로 담았습니다.
      </p>

      <ul className="mt-8 space-y-4">
        {DEMOS.map((d) => (
          <li key={d.href}>
            <Link
              href={d.href}
              className="block rounded-lg border-2 border-border px-5 py-5 no-underline"
            >
              <p className="text-fg-muted">{d.eyebrow}</p>
              <p className="mt-1 text-[1.15rem] font-bold text-fg">{d.title}</p>
              <p className="mt-2 leading-relaxed text-fg-muted">{d.detail}</p>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-10 leading-relaxed text-fg-muted">
        본인 사건을 직접 확인하시려면{" "}
        <Link href="/consult" className="text-accent underline">상담</Link>을 시작하시거나,
        가입 직후라면{" "}
        <Link href="/precheck" className="text-accent underline">가입 전 확인</Link>부터
        보시면 됩니다.
      </p>
    </div>
  );
}
