import type { ContractComparison } from "./contract-comparison";
import { QUESTIONS } from "./aftercare";

/** PC-004·RES-006: 입력한 단일 연 금리만 비교한다. 법적 판단·상환액 추정은 하지 않는다. */
export function annualRateDifference(row: ContractComparison) {
  const read = (text: string) => {
    if (!/금리|이자율/.test(text) || /최저|최고|우대|연체|중도|변동|월\s*\d|~|∼/.test(text)) return null;
    const matches = [...text.matchAll(/연\s*(\d{1,2}(?:\.\d{1,4})?)\s*%/g)];
    if (matches.length !== 1 || (text.match(/%/g) ?? []).length !== 1) return null;
    return Number(matches[0][1]);
  };
  if (row.result !== "DIFFERENT_TEXT") return null;
  const before = read(row.before), contract = read(row.contract);
  if (before === null || contract === null || before === contract) return null;
  return { before, contract, delta: Number((contract - before).toFixed(4)) };
}

export function aftercarePresentation(comparison: ContractComparison[], answers: Record<string, string>) {
  const provided = comparison.filter(row => row.result !== "NOT_PROVIDED" && row.contract.trim());
  const missing = comparison.filter(row => !provided.includes(row));
  const different = provided.filter(row => row.result === "DIFFERENT_TEXT");
  const rate = different.map(annualRateDifference).find(value => value !== null);
  const gaps = QUESTIONS.filter(q => {
    const answer = answers[q.code];
    return q.code.startsWith("EXPLAINED_") || q.code === "UNDERSTOOD_TERMS"
      ? answer === "PARTIAL" || answer === "NO" : false;
  }).map(q => ({ code: q.code, question: q.text, answer: q.options.find(o => o.value === answers[q.code])!.label }));
  const requests = [
    ...different.map(row => `가입 전 안내: “${row.before}”\n계약 문구: “${row.contract}”\n두 문구가 다른 이유와 실제 적용 조건·적용 시점을 서면으로 설명해 주세요.`),
    ...(gaps.some(g => g.code === "EXPLAINED_RATE_AND_FEES") ? ["금리 산정 근거와 모든 수수료의 금액·부과 조건을 설명해 주세요."] : []),
    ...(gaps.some(g => g.code === "EXPLAINED_PENALTY") ? ["중도상환수수료의 적용 기간·계산 방법과 연체 시 불이익을 설명해 주세요."] : []),
    ...(gaps.some(g => g.code === "UNDERSTOOD_TERMS") ? ["이해하지 못한 계약 조건을 쉽게 설명하고 관련 설명서 사본을 제공해 주세요."] : []),
    ...(different.length ? ["안내나 계약서에 잘못 기재된 내용이 있다면 정정 절차와 처리 결과를 서면으로 알려 주세요."] : []),
    ...(answers.HAS_CONTRACT_COPY === "NO" ? ["가입 당시 계약서와 상품설명서 사본을 제공해 주세요."] : []),
  ];
  return { provided, missing, different, rate, gaps, requests,
    draft: requests.length ? `제목: 가입 당시 설명과 계약 조건 확인 요청\n\n아래 내용은 제가 보관한 권유 기록과 입력한 계약 문구를 바탕으로 작성했습니다.\n\n${requests.map((r, i) => `${i + 1}. ${r}`).join("\n\n")}\n\n답변은 기록으로 보관할 수 있도록 서면으로 부탁드립니다.` : null };
}
