/**
 * FinShield 첫 화면 (S-001).
 *
 * 이 배포의 주인은 FinShield 다. 거래 전 검증이 첫 화면에서 시작한다.
 * 들여온 PreCase Runtime 은 가입 뒤 축이라 별도 경로로 옮겼다.
 *
 * 여기에 정확도·건수 같은 성능 수치를 걸지 않는다. 수치는 표본과 회차를 함께
 * 적어야 하고, 아직 그 근거를 만들지 않았다. PreCase 의 성능을 FinShield 의
 * 성능으로 표시하지도 않는다 (OPS-002).
 *
 * Release Gate 를 통과하기 전이므로 출시 완료로 표시하지 않는다 (규칙 8).
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FinShield — 거래 전 금융정보 검증",
  description: "권유받은 내용을 공식 자료에 대고 확인하고 근거를 그대로 보여 드립니다.",
};

const CARD = "block rounded-xl border border-slate-200 bg-white p-5 no-underline";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[0.9rem] font-bold text-amber-900">
          시험 단계 · 출시 전
        </p>
        <h1 className="mt-3 text-[1.9rem] font-bold leading-tight tracking-tight text-navy">
          송금하기 전에, 공식 자료로 확인합니다
        </h1>
        <p className="mt-3 text-[1.02rem] leading-relaxed text-slate-700">
          권유받은 내용에서 확인할 항목을 뽑아 드립니다. 고르신 항목만 법령과 공식 상품 자료와
          공식 채널 등록부에 대고 확인하고, 무엇을 근거로 그렇게 판단했는지 그대로 보여 드립니다.
        </p>
        <p className="mt-3 text-[0.98rem] leading-relaxed text-slate-600">
          확인하지 못한 것은 확인하지 못했다고 적습니다. 안전하다고 말하지 않고, 사기라고
          단정하지도 않습니다. 가입과 송금을 대신 결정하거나 실행하지 않습니다.
        </p>
      </header>

      <nav className="mt-8 space-y-3">
        <Link href="/verify" className={`${CARD} border-navy/25 bg-navy/5`}>
          <span className="block text-[1.1rem] font-bold text-navy">거래 전에 확인하기</span>
          <span className="mt-1 block text-[0.95rem] leading-relaxed text-slate-700">
            문자나 통화로 받은 권유 내용을 붙여 넣으면 확인할 항목을 만들어 드립니다.
          </span>
        </Link>
        <Link href="/precase" className={CARD}>
          <span className="block text-[1.1rem] font-bold text-navy">이미 가입했거나 문제가 생겼어요</span>
          <span className="mt-1 block text-[0.95rem] leading-relaxed text-slate-700">
            금융감독원 공개 조정례로 설명 적정성과 분쟁 성립 가능성을 살펴봅니다.
          </span>
        </Link>
      </nav>

      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-[1.1rem] font-bold text-navy">지금 확인할 수 있는 범위</h2>
        <ul className="mt-3 space-y-2 text-[0.95rem] leading-relaxed text-slate-700">
          <li>법령과 판례는 법제처 공개 API 로 실제 조회합니다.</li>
          <li>상품과 기관과 공식 채널은 공공데이터 포털에서 받아 둔 자료로 확인합니다.</li>
          <li>소비자 경보와 약관 조항은 아직 자료를 넣지 않았습니다. 그 항목은 확인하지 못했다고 적습니다.</li>
        </ul>
        <p className="mt-4 text-[0.9rem] leading-relaxed text-slate-500">
          시험 단계입니다. 실제 개인정보와 실제 금융 서류를 넣지 마세요. 넣으셔도 저장 전에
          가려지지만, 애초에 받지 않는 것이 안전합니다.
        </p>
      </section>
    </div>
  );
}
