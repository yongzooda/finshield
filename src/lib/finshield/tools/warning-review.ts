/** EV-007·EV-009: 검토한 일반 지침과 현재 거래의 발생·범죄 증명을 구분한다. */
export const WARNING_REVIEW = Object.freeze({
  officialId: "kinfa:notice:24020",
  contentHash: "d584f37fa160619ab0f3c97b81ddafcd26d3a82df9a5fc5f2047d684fe0645e9",
  reviewedAt: "2026-09-08T11:31:40.000Z",
  reviewDueAt: "2026-09-15T11:31:40.000Z",
  scope: "PUBLIC_GUIDANCE_COMPARISON",
});
export const reviewedWarningIsUsable = (hash: string, now: number) =>
  hash === WARNING_REVIEW.contentHash && now >= Date.parse(WARNING_REVIEW.reviewedAt)
    && now < Date.parse(WARNING_REVIEW.reviewDueAt);
