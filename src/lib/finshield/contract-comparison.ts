/** PC-002: 이전 Passport의 권유 문장과 사용자가 입력한 계약 문구를 나란히 남긴다. */
export type ContractComparison = {
  claim_id: string; before: string; contract: string;
  result: "SAME_TEXT" | "DIFFERENT_TEXT" | "NOT_PROVIDED";
};
export type PriorClaim = { claim_id: string; statement_masked: string };

export function compareContractText(claims: PriorClaim[], terms: Record<string, string>): ContractComparison[] {
  const normalized = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();
  return claims.map(claim => {
    const contract = (terms[claim.claim_id] ?? "").trim();
    return {
      claim_id: claim.claim_id, before: claim.statement_masked, contract,
      result: !contract ? "NOT_PROVIDED" : normalized(claim.statement_masked) === normalized(contract)
        ? "SAME_TEXT" : "DIFFERENT_TEXT",
    };
  });
}
