/**
 * 테스트 전역 환경 로더.
 *
 * `env.ts`는 기본값 없이 모듈 로드 시점에 검증한다(설정 누락을 배포 순간에
 * 드러내려는 의도). 그래서 이 모듈을 거치는 테스트는 값이 미리 있어야 한다.
 * 여기서 `.env.local`을 한 번만 읽어 채운다 — 파일이 없으면(예: CI) 조용히
 * 넘어가고, DB가 필요한 테스트는 각자 skip 조건으로 걸러진다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

try {
  const raw = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (process.env[key] === undefined) {
      process.env[key] = val.trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // .env.local 없음 — DB 의존 테스트는 skip된다
}
