import type { ParsedPage } from "./parser";

export const OCR_LOW_CONFIDENCE_THRESHOLD = 0.9;

export type OcrReviewField = {
  field_kind: "URL" | "INSTITUTION" | "PRODUCT" | "NUMBER";
  confidence_milli: number;
  bbox: [number, number, number, number];
  start: number;
  end: number;
};

const kindOf = (text: string): OcrReviewField["field_kind"] | null => {
  if (/https?:\/\/|www\.|\b[a-z0-9.-]+\.[a-z]{2,}\b/iu.test(text)) return "URL";
  if (/(?:은행|금융지주|금융진흥원|금융위원회|금융감독원|보증재단|보증기금|저축은행)/u.test(text)) return "INSTITUTION";
  if (/(?:햇살론|대출|론|카드|보증|적금|예금)/u.test(text)) return "PRODUCT";
  return /\d/u.test(text) ? "NUMBER" : null;
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
    if (!fieldKind) continue;
    result.push({
      field_kind: fieldKind,
      confidence_milli: Math.max(0, Math.min(1000, Math.round(word.confidence * 1000))),
      bbox: word.bbox as OcrReviewField["bbox"],
      start,
      end: start + token.length,
    });
    if (result.length === 100) break;
  }
  return result;
}

/** Claim의 마스킹 문구 구간과 실제로 겹치는 저신뢰 필드만 확인 대상으로 연결한다. */
export function lowConfidenceFieldsForSpan(
  fields: OcrReviewField[], locator: { start: number; end: number },
): OcrReviewField[] {
  return fields.filter((field) => field.start < locator.end && field.end > locator.start);
}
