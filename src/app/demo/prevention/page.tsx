/**
 * 예방 데모 (시나리오 A) — 홈쇼핑 · 저축성보험 · 63세.
 *
 * S-02의 결과 단계를 **같은 컴포넌트로** 렌더한다. 데모용으로 따로 만들면
 * 실제 화면이 바뀔 때 데모만 옛 모습으로 남는다 — 그러면 심사위원이 본 것과
 * 서비스가 하는 일이 달라진다.
 *
 * 데이터는 배포 번들의 정적 자산이라 DB 조회가 없다 (DR-107).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ResultSections } from "../../precheck/views";
import { CHANNEL_LABELS, PRODUCT_LABELS } from "@/lib/labels";
import type { RiskPatternResult } from "@/lib/tools/analyze_risk_pattern";
import type { CheckDocumentsResult } from "@/lib/tools/check_documents";
import { DemoLabel } from "../demo-label";
import demo from "@/lib/demo/prevention";

export const metadata: Metadata = { title: "데모 — 가입 전 확인 | 프리케이스" };

export default function DemoPreventionPage() {
  const risk = demo.risk as unknown as RiskPatternResult;
  const docs = demo.docs as unknown as CheckDocumentsResult;

  return (
    <>
      <DemoLabel what="홈쇼핑으로 저축성보험에 가입한 63세를 가정한 예시입니다." />

      <article className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight text-fg">
          이 조합에서 확인하실 것
        </h1>
        <p className="mt-3 leading-relaxed text-fg-muted">
          고르신 조건: {PRODUCT_LABELS[demo.product]} · {CHANNEL_LABELS[demo.channel]} · {demo.age}세
        </p>

        {/* 실화면(S-02)과 같은 본문 — 갈라지면 심사위원이 본 것과 서비스가 달라진다 */}
        <ResultSections risk={risk} docs={docs} product={demo.product} channel={demo.channel} />

        <p className="mt-12">
          <Link
            href="/precheck"
            className="inline-flex items-center rounded-lg bg-accent px-7 py-3 text-[1.05rem] font-bold text-accent-fg no-underline"
          >
            내 조건으로 직접 확인하기
          </Link>
        </p>
      </article>
    </>
  );
}
