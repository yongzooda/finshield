// ============================================================
// 검토한 진흥원 예방 공지가 아직 같은 본문인지, 검토 기한이 곧 끝나지 않는지 본다.
//
// 고위험 행동 경고(선입금·원격제어 앱 요구)와 공식 예방 지침 비교는 검토한 본문
// Hash 가 같고 검토 기한 안일 때만 동작한다 (warning-review.ts). 기한이 지나거나
// 본문이 바뀌면 오류 없이 참고 자료로 돌아가 경고가 조용히 사라진다. 예약 실행이
// 그 전에 실패해 관리자에게 알리게 한다. DB 에 쓰지 않고 비밀도 쓰지 않는다.
//
// 사용: node scripts/kb/check-warning-review.mjs
// ============================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { warningSectionBounds } from "../../src/lib/finshield/tools/warning-section.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const NOTICE_URL = "https://www.kinfa.or.kr/notificationPromotion/noticeDetail.do?seq=24020";
// 기한이 이만큼 남았을 때부터 실패시켜 다시 검토할 시간을 둔다.
export const RENEW_BEFORE_MS = 72 * 60 * 60 * 1000;

/** warning-review.ts 의 고정값을 읽는다. 형식을 못 읽으면 추정하지 않고 멈춘다. */
export const readReviewConstants = (source) => {
  const field = (name) => source.match(new RegExp(`${name}: "([^"]+)"`))?.[1];
  const review = { officialId: field("officialId"), contentHash: field("contentHash"), reviewDueAt: field("reviewDueAt") };
  if (review.officialId !== "kinfa:notice:24020" || !/^[0-9a-f]{64}$/.test(review.contentHash ?? "")
    || !Number.isFinite(Date.parse(review.reviewDueAt ?? ""))) {
    throw new Error("warning-review.ts 의 검토 값을 읽지 못했다");
  }
  return review;
};

/** 받은 공지 HTML 과 검토 값을 비교한다. DB·네트워크에 닿지 않는 순수 함수다. */
export const assessWarningReview = ({ review, html, now }) => {
  const problems = [];
  let observedHash = null;
  try {
    observedHash = createHash("sha256").update(warningSectionBounds(html).original).digest("hex");
  } catch {
    problems.push("공지 본문 구조가 바뀌어 본문을 자르지 못했다");
  }
  if (observedHash && observedHash !== review.contentHash) problems.push("공지 본문이 검토한 본문과 달라졌다");
  const remaining = Date.parse(review.reviewDueAt) - now;
  if (remaining <= 0) problems.push("검토 기한이 지났다");
  else if (remaining <= RENEW_BEFORE_MS) problems.push(`검토 기한이 ${Math.ceil(remaining / 3_600_000)}시간 안에 끝난다`);
  return { ok: problems.length === 0, problems, observedHash, reviewDueAt: review.reviewDueAt };
};

const main = async () => {
  const review = readReviewConstants(readFileSync(resolve(ROOT, "src/lib/finshield/tools/warning-review.ts"), "utf8"));
  const response = await fetch(NOTICE_URL, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`공지 응답 ${response.status}`);
  const html = Buffer.from(await response.arrayBuffer()).toString("utf8");
  const result = assessWarningReview({ review, html, now: Date.now() });
  console.log(`예방 공지 본문 Hash ${result.observedHash?.slice(0, 12) ?? "없음"} · 검토 기한 ${result.reviewDueAt}`);
  if (!result.ok) {
    for (const problem of result.problems) console.error(`다시 검토 필요: ${problem}`);
    console.error("절차는 docs/ops/official-warning-review.md 를 따른다.");
    process.exitCode = 1;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`예방 공지 점검 실패: ${String(error?.message ?? error).slice(0, 160)}`);
    process.exit(1);
  });
}
