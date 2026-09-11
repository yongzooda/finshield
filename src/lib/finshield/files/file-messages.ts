/**
 * 파일 거부·실패를 이용자가 고칠 수 있는 묶음으로 옮긴다 (INP-003·INP-004).
 *
 * 검사기의 사유 코드와 한도는 그대로 두고, 화면에는 무엇을 바꾸면 되는지만 알린다.
 * 모든 거부가 같은 문구면 10쪽을 넘긴 PDF와 보호 설정 PDF를 구분하지 못해 같은 파일을
 * 되풀이해 올린다. 파일 원문·세부 계측값은 싣지 않는다.
 */

const ACTIVE = ["active-content", "open-action", "embedded-file", "executable-payload"];
const TYPE = ["unknown-type", "type-mismatch", "extension-mismatch", "foreign-signature"];

/** 격리 검사 결과(`{ok:false, code, reasons}`)를 오류 코드 하나로 줄인다. */
export function rejectionCode(value: unknown): string {
  const record = value && typeof value === "object" ? value as { ok?: unknown; code?: unknown; reasons?: unknown } : null;
  if (!record || record.ok !== false) return "FILE_REJECTED";
  const code = typeof record.code === "string" ? record.code : "";
  const reasons = Array.isArray(record.reasons) ? record.reasons.filter((reason): reason is string => typeof reason === "string") : [];
  if (code === "PAGE_LIMIT" || reasons.includes("page-limit")) return "FILE_PAGE_LIMIT";
  if (code === "PIXEL_LIMIT" || reasons.includes("pixel-limit")) return "FILE_PIXEL_LIMIT";
  if (code === "TEXT_LIMIT") return "FILE_TEXT_LIMIT";
  if (reasons.includes("encrypted")) return "FILE_ENCRYPTED";
  if (reasons.some(reason => ACTIVE.includes(reason))) return "FILE_ACTIVE_CONTENT";
  if (reasons.includes("too-large")) return "FILE_TOO_LARGE";
  if (reasons.some(reason => TYPE.includes(reason))) return "FILE_TYPE_MISMATCH";
  if (reasons.includes("trailing-data")) return "FILE_TRAILING_DATA";
  return "FILE_REJECTED";
}

const MESSAGES: Record<string, string> = {
  OCR_CONSENT_REQUIRED: "이미지나 스캔 PDF는 별도 OCR 동의가 필요합니다. 동의하지 않으려면 내용을 텍스트로 입력해 주세요.",
  OCR_UNAVAILABLE: "OCR 연결이 아직 준비되지 않았습니다. 내용을 텍스트로 입력해 주세요.",
  OCR_REVIEW_TOO_MANY_FIELDS: "흐리게 읽힌 문구가 너무 많습니다. 더 선명한 사진으로 다시 올리거나 내용을 텍스트로 입력해 주세요.",
  OCR_BUSY: "문서 인식 요청이 몰려 있습니다. 잠시 후 다시 올려 주세요.",
  PII_RESIDUAL: "개인정보를 안전하게 가리지 못했습니다. 이름·연락처·계좌번호를 제거한 뒤 다시 입력해 주세요.",
  CLAIM_PAGE_AMBIGUOUS: "항목의 원문 위치를 정확히 구분하지 못했습니다. 해당 구절을 텍스트로 입력해 주세요.",
  FILE_REJECTED: "지원하지 않거나 안전하게 읽을 수 없는 파일입니다. PDF·PNG·JPG 형식을 확인해 주세요.",
  FILE_PAGE_LIMIT: "PDF는 10쪽까지 읽습니다. 필요한 쪽만 따로 저장해 다시 올려 주세요.",
  FILE_PIXEL_LIMIT: "이미지가 너무 큽니다. 한 장에 약 2,500만 화소(예: 5000×5000) 이하로 줄여 다시 올려 주세요.",
  FILE_TEXT_LIMIT: "한 쪽의 글자가 너무 많아 읽지 않았습니다. 필요한 부분만 텍스트로 붙여 넣어 주세요.",
  FILE_ENCRYPTED: "암호나 보호 설정(인쇄·복사 제한 포함)이 걸린 PDF는 열지 않습니다. 필요한 화면을 캡처해 이미지로 올리거나 내용을 텍스트로 붙여 넣어 주세요.",
  FILE_ACTIVE_CONTENT: "스크립트·첨부 파일처럼 실행될 수 있는 요소가 든 PDF는 열지 않습니다. 필요한 화면을 캡처해 이미지로 올리거나 내용을 텍스트로 붙여 넣어 주세요.",
  FILE_TOO_LARGE: "파일은 10 MiB까지 올릴 수 있습니다. 크기를 줄여 다시 올려 주세요.",
  FILE_TYPE_MISMATCH: "파일 내용이 확장자와 맞지 않습니다. PDF·PNG·JPG 원본 파일로 다시 올려 주세요.",
  FILE_TRAILING_DATA: "이미지 끝에 확인할 수 없는 데이터가 붙어 있어 열지 않았습니다. 화면을 캡처하거나 이미지를 다시 저장해 올려 주세요.",
  FILE_TEXT_EMPTY: "문서에서 읽을 수 있는 글자를 찾지 못했습니다. 글자가 선명한 파일로 다시 올리거나 내용을 텍스트로 붙여 넣어 주세요.",
  CLAIMS_NOT_FOUND: "문서에서 확인할 금융 조건을 찾지 못했습니다. 금리·한도·기관·신청 방법이 보이는 부분을 올리거나 텍스트로 붙여 넣어 주세요.",
};

export function fileErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (MESSAGES[message]) return MESSAGES[message];
  if (String((error as { code?: string })?.code ?? "") === "MODEL_BUDGET_BLOCKED") {
    return "오늘 사용할 수 있는 확인 한도에 도달했습니다. 내일 다시 시도하거나 로그인 없이 체험을 이용해 주세요.";
  }
  const name = String((error as { name?: string })?.name ?? "");
  if (name === "TimeoutError" || name === "AbortError") {
    return "문서를 읽는 데 시간이 오래 걸려 멈췄습니다. 쪽수를 줄이거나 필요한 부분만 올려 주세요.";
  }
  return "파일 내용을 끝까지 읽지 못했습니다. 파일을 다시 올리거나 텍스트로 입력해 주세요.";
}
