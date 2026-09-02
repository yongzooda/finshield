/**
 * 실자원(DB·법제처·모델)이 붙어 있는지 한곳에서 판정한다.
 *
 * CI에는 자격증명이 없다. 그런데 `env.ts`는 기본값 없이 모듈 로드 시점에 검증하므로
 * (설정 누락을 배포 순간에 드러내려는 의도) CI에서도 **형식만 맞는 더미 값**을
 * 넣어야 렌더·순수 로직 테스트가 돈다. 그러면 `DATABASE_URL`이 존재하게 되어
 * DB 테스트가 붙으려 들다 실패한다.
 *
 * 그래서 존재 여부가 아니라 **실자원 사용 의사**를 따로 본다. CI는 `PRECASE_CI=1`을
 * 켜고, 그때 DB·외부 API 테스트는 skip된다 — 자격증명 없이 도는 검증(마스킹·환각
 * 대조·로그 정책·렌더)만 남으므로 **배포 게이트는 그대로 지켜진다.**
 */

const ci = process.env.PRECASE_CI === "1";

export const dbReady = !ci && Boolean(process.env.DATABASE_URL);
export const lawReady = !ci && Boolean(process.env.DATABASE_URL && process.env.LAW_API_OC);
