"use client";
import { useState } from "react";
import { FsCard, FsChip } from "../../../fs-shell";
import type { ContractComparison } from "@/lib/finshield/contract-comparison";
import { aftercarePresentation } from "@/lib/finshield/aftercare-presentation";

export function AftercareInsights({ comparison, answers, urgent = false }: {
  comparison: ContractComparison[]; answers: Record<string,string>; urgent?: boolean;
}) {
  const info = aftercarePresentation(comparison, answers);
  const [copyStatus, setCopyStatus] = useState("");
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const draft = editedDraft ?? info.draft;
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft!); setCopyStatus("요청 문구를 복사했습니다. 내용을 확인한 뒤 금융회사에 전달하세요."); }
    catch { setCopyStatus("자동 복사를 하지 못했습니다. 아래 요청 문구를 직접 선택해 복사하세요."); }
  };
  const comparisonRow = (row: ContractComparison) => <section key={row.claim_id} className="border-t border-[var(--fs-line)] pt-4 first:border-0 first:pt-0">
    <FsChip tone={row.result === "DIFFERENT_TEXT" ? "caution" : "neutral"}>{row.result === "DIFFERENT_TEXT" ? "입력한 문구가 다릅니다" : row.result === "SAME_TEXT" ? "입력 문구 일치" : "이번 점검에 계약 문구를 넣지 않았습니다"}</FsChip>
    <div className="mt-3 grid gap-3 md:grid-cols-2"><p className="fs-body"><strong>가입 전 안내</strong><br/>{row.before}</p><p className="fs-body"><strong>입력한 계약 내용</strong><br/>{row.contract || "계약 문구를 추가하면 비교할 수 있습니다."}</p></div>
  </section>;
  return <>
    <FsCard className="mt-8">
      <p className="fs-eyebrow">이번 점검에서 확인한 내용</p>
      <h2 className="fs-h2 mt-2">{info.rate ? `안내받은 연 ${info.rate.before}%와 입력한 계약의 연 ${info.rate.contract}%가 다릅니다` : info.different.length ? `안내와 계약 문구 ${info.different.length}곳이 다릅니다` : info.provided.length ? "입력한 계약 문구와 설명 답변을 점검했습니다" : "계약 비교 없이 설명받은 내용과 이해도를 점검했습니다"}</h2>
      {info.rate ? <p className="mt-3 text-xl font-bold">입력한 금리 기준 {Math.abs(info.rate.delta)}%p {info.rate.delta > 0 ? "높습니다" : "낮습니다"}</p> : null}
      <p className="fs-body mt-3">{info.different.length ? "실제 계약서·가입 당시 안내에서 같은 조건을 가리키는지 확인하고, 차이의 이유와 적용 조건을 금융회사에 서면으로 요청하세요." : "답변한 내용과 제공한 문구까지만 점검했습니다. 문구가 같더라도 계약 전체가 적절하다는 뜻은 아닙니다."}</p>
      {info.rate ? <p className="fs-meta mt-2">두 입력 문구의 연 금리 수치 차이입니다. 실제 적용 금리·총이자·위법 여부를 확정한 결과는 아닙니다.</p> : null}
      <p className="fs-meta mt-3">계약 문구 {info.provided.length}개 비교 · {info.missing.length}개 미입력 · 설명·이해 관련 보완 답변 {info.gaps.length}개</p>
      {info.draft && !urgent ? <a href="#aftercare-request" className="fs-btn fs-btn--primary mt-4">차이를 확인할 요청 문구 보기</a> : null}
    </FsCard>
    {info.provided.length ? <FsCard><h2 className="fs-h2">비교한 계약 내용</h2><div className="mt-4 space-y-5">{[...info.different,...info.provided.filter(row => row.result !== "DIFFERENT_TEXT")].map(comparisonRow)}</div></FsCard> : null}
    {info.gaps.length ? <FsCard><h2 className="fs-h2">추가 설명을 받아야 할 부분</h2><ul className="mt-4 space-y-4">{info.gaps.map(gap => <li key={gap.code}><p className="font-bold">{gap.question}</p><p className="fs-body mt-1">내 답변: {gap.answer}</p></li>)}</ul></FsCard> : null}
    {info.draft ? <FsCard><h2 id="aftercare-request" className="fs-h2 scroll-mt-24">금융회사에 보낼 확인 요청</h2><p className="fs-body mt-2">입력한 차이와 답변을 정리했습니다. 계약서 원문과 대조해 고친 뒤 금융회사의 공식 고객센터에 전달하세요. 자동으로 발송하지 않습니다.{urgent ? " 이미 송금·피해가 의심되면 아래 긴급 대응을 먼저 진행하세요." : ""}</p><textarea aria-label="복사할 확인 요청 문구" value={draft ?? ""} onChange={event => { setEditedDraft(event.target.value); setCopyStatus(""); }} rows={12} className="fs-field mt-4"/><button type="button" disabled={!draft?.trim()} onClick={() => void copy()} className="fs-btn fs-btn--primary mt-3">요청 문구 복사</button><p role="status" className="fs-meta mt-2">{copyStatus}</p><p className="fs-meta mt-3">함께 준비할 자료: 비교할 조건이 적힌 권유 기록·계약서 해당 쪽·가입 당시 상품설명서. 원본은 본인 기기에 보관하세요.</p></FsCard> : null}
    {info.missing.length ? <FsCard><details><summary className="font-bold cursor-pointer">이번에 비교하지 않은 항목 {info.missing.length}개</summary><p className="fs-body mt-2">계약 문구를 입력하지 않아 비교 대상에서 제외했습니다. 오류나 검증 실패가 아닙니다. 답변을 보완해 새 점검을 만들면 이어서 비교할 수 있습니다.</p><div className="mt-4 space-y-5">{info.missing.map(comparisonRow)}</div></details></FsCard> : null}
  </>;
}
