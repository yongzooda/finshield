import { expect, it } from "vitest";
import { fileErrorMessage, rejectionCode } from "../files/file-messages";

it.each([
  [{ ok: false, code: "FILE_REJECTED", reasons: ["page-limit"] }, "FILE_PAGE_LIMIT"],
  [{ ok: false, code: "PAGE_LIMIT" }, "FILE_PAGE_LIMIT"],
  [{ ok: false, code: "FILE_REJECTED", reasons: ["encrypted", "no-pages"] }, "FILE_ENCRYPTED"],
  [{ ok: false, code: "FILE_REJECTED", reasons: ["open-action"] }, "FILE_ACTIVE_CONTENT"],
  [{ ok: false, code: "FILE_REJECTED", reasons: ["type-mismatch", "extension-mismatch"] }, "FILE_TYPE_MISMATCH"],
  [{ ok: false, code: "FILE_REJECTED", reasons: ["trailing-data"] }, "FILE_TRAILING_DATA"],
  [{ ok: false, code: "FILE_REJECTED", reasons: ["malformed-xref"] }, "FILE_REJECTED"],
  [{ ok: false, code: "PARSER_FAILED" }, "FILE_REJECTED"],
  [{ ok: true, pages: "형식 위반" }, "FILE_REJECTED"],
  [null, "FILE_REJECTED"],
])("검사 거부 %j 는 %s 로 옮긴다", (value, code) => {
  expect(rejectionCode(value)).toBe(code);
});

it("사유별 문구는 무엇을 바꾸면 되는지 알리고 모르는 오류는 일반 문구로 남긴다", () => {
  expect(fileErrorMessage(new Error("FILE_PAGE_LIMIT"))).toContain("10쪽");
  expect(fileErrorMessage(new Error("FILE_ENCRYPTED"))).toContain("보호 설정");
  expect(fileErrorMessage(Object.assign(new Error("x"), { code: "MODEL_BUDGET_BLOCKED" }))).toContain("한도");
  expect(fileErrorMessage(Object.assign(new Error("x"), { name: "TimeoutError" }))).toContain("시간");
  expect(fileErrorMessage(new Error("합성 내부 오류"))).toBe("파일 내용을 끝까지 읽지 못했습니다. 파일을 다시 올리거나 텍스트로 입력해 주세요.");
});

it("OCR 한도·실패 코드도 이용자가 할 일로 옮긴다", () => {
  expect(fileErrorMessage(new Error("OCR_IMAGE_TOO_LONG"))).toContain("8,000픽셀");
  expect(fileErrorMessage(new Error("OCR_REQUEST_FAILED"))).toContain("나눠");
});
