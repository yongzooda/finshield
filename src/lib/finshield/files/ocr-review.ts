import type { ParsedPage } from "./parser";

export const OCR_LOW_CONFIDENCE_THRESHOLD = 0.9;

export type OcrReviewField = {
  field_kind: "URL" | "INSTITUTION" | "PRODUCT" | "NUMBER" | "NEGATION" | "TEXT";
  confidence_milli: number;
  bbox: [number, number, number, number];
  start: number;
  end: number;
};

const kindOf = (text: string): OcrReviewField["field_kind"] => {
  if (/https?:\/\/|www\.|\b[a-z0-9.-]+\.[a-z]{2,}\b/iu.test(text)) return "URL";
  if (/(?:은행|금융지주|금융진흥원|금융위원회|금융감독원|보증재단|보증기금|저축은행)/u.test(text)) return "INSTITUTION";
  if (/(?:햇살론|대출|론|카드|보증|적금|예금)/u.test(text)) return "PRODUCT";
  if (/(?:없|않|아니|불가|불허|금지|제외|면제|못|미승인|취소|종료)/u.test(text)) return "NEGATION";
  return /\d/u.test(text) ? "NUMBER" : "TEXT";
};

/** INP-007: 마스킹한 페이지에서 판단에 직접 쓰이는 저신뢰 필드의 위치만 고른다. */
export function lowConfidenceFields(page: ParsedPage, maskedText = page.text): OcrReviewField[] {
  const result: OcrReviewField[] = [];
  let cursor = 0;
  for (const word of page.words) {
    const token = word.text.trim();
    if (!token) continue;
    const start = maskedText.indexOf(token, cursor);
    if (start < 0) continue;
    cursor = start + token.length;
    if (word.confidence === undefined || word.confidence >= OCR_LOW_CONFIDENCE_THRESHOLD) continue;
    const fieldKind = kindOf(token);
    result.push({
      field_kind: fieldKind,
      confidence_milli: Math.max(0, Math.min(1000, Math.floor(word.confidence * 1000))),
      bbox: word.bbox as OcrReviewField["bbox"],
      start,
      end: start + token.length,
    });
    if (result.length > 100) throw new Error("OCR_REVIEW_TOO_MANY_FIELDS");
  }
  return result;
}

/** Claim의 마스킹 문구 구간과 실제로 겹치는 저신뢰 필드만 확인 대상으로 연결한다. */
export function lowConfidenceFieldsForSpan(
  fields: OcrReviewField[], locator: { start: number; end: number },
): OcrReviewField[] {
  return fields.filter((field) => field.start < locator.end && field.end > locator.start);
}
