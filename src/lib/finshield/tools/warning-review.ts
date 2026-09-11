/**
 * EV-007·EV-009: 검토한 일반 지침과 현재 거래의 발생·범죄 증명을 구분한다.
 *
 * 검토 기한 안에 같은 본문을 다시 가져온 경우에만 요구 조건 비교에 쓴다. 기한을
 * 늘리려면 공식 공지를 다시 받아 본문 Hash 가 검토한 값과 같은지 먼저 확인하고
 * `evidence/development/warning-review/` 에 확인 기록을 남긴다. 절차와 이력은
 * `docs/ops/official-warning-review.md` 를 따른다.
 */
export const WARNING_REVIEW = Object.freeze({
  officialId: "kinfa:notice:24020",
  contentHash: "d584f37fa160619ab0f3c97b81ddafcd26d3a82df9a5fc5f2047d684fe0645e9",
  reviewedAt: "2026-09-11T03:28:22.000Z",
  reviewDueAt: "2026-10-11T03:28:22.000Z",
  scope: "PUBLIC_GUIDANCE_COMPARISON",
});
export const reviewedWarningIsUsable = (hash: string, now: number) =>
  hash === WARNING_REVIEW.contentHash && now >= Date.parse(WARNING_REVIEW.reviewedAt)
    && now < Date.parse(WARNING_REVIEW.reviewDueAt);
