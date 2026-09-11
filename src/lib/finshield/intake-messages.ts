/**
 * 접수 실패를 이용자가 할 수 있는 일로 옮긴다. 모든 실패가 같은 문구면 한도 소진·시간
 * 초과·항목 없음을 구분하지 못하고 같은 입력을 되풀이한다. 내부 사정·원문은 보내지 않는다.
 */
export function intakeErrorMessage(error: unknown): string {
  const code = String((error as { code?: string })?.code ?? "");
  const name = String((error as { name?: string })?.name ?? "");
  const message = error instanceof Error ? error.message : "";
  if (code === "MODEL_BUDGET_BLOCKED") {
    return "오늘 사용할 수 있는 확인 한도에 도달했습니다. 내일 다시 시도하거나 로그인 없이 체험을 이용해 주세요.";
  }
  if (name === "TimeoutError" || name === "AbortError") {
    return "확인할 항목을 뽑는 데 시간이 오래 걸려 멈췄습니다. 잠시 뒤 다시 시도하거나 문장을 조금 줄여 주세요.";
  }
  if (message === "CLAIMS_NOT_FOUND") {
    return "확인할 금융 조건을 찾지 못했습니다. 금리·한도·기관·신청 방법이 드러난 권유 문장을 넣어 주세요.";
  }
  if (/^CLAIM_(?:SOURCE_NOT_FOUND|NUMBERS_CHANGED|FACTS_REMOVED)$/.test(message)) {
    return "권유 문장에서 확인할 항목을 정확히 옮기지 못했습니다. 다시 시도해 주세요.";
  }
  return "접수하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
}
