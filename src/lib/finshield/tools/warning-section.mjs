// 진흥원 공지 본문 구간을 자른다.
// 운영 도구(official-warning.ts)와 예약 점검 스크립트가 같은 경계로 본문 Hash 를 내게 한다.
// 경계가 다르면 같은 공지를 두고 둘이 다른 Hash 를 보고 서로 어긋난다.
export const warningSectionBounds = (html) => {
  const headerStart = html.indexOf('<div class="board-detail-header">');
  const start = html.indexOf('<div class="board-detail-con ', headerStart);
  const end = html.indexOf('<div class="board-detail-footer">', start);
  if (headerStart < 0 || start < 0 || end < 0) throw new Error("OFFICIAL_WARNING_STRUCTURE_CHANGED");
  return { header: html.slice(headerStart, start), original: html.slice(start, end) };
};
