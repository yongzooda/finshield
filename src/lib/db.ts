/**
 * DB 커넥션 — app_runtime 롤 전용.
 *
 * 이 롤은 정적 자산 10종 SELECT + 캐시(INSERT·UPDATE) + 신고(INSERT) +
 * 카운터(INSERT·UPDATE)만 가능하다 (마이그레이션 0002). 정적 자산 쓰기가
 * 필요해 보이면 코드가 아니라 설계를 의심할 것 — 인젝션이 성공해도 코퍼스를
 * 오염시킬 수 없다는 성질(P-501)이 이 롤 위에 서 있다.
 *
 * 배치 적재는 파이썬 스크립트(scripts/) + batch_loader 롤의 일이다.
 * 이 모듈은 BATCH_DATABASE_URL을 모른다 (P-502).
 */

import "server-only";
import postgres from "postgres";
import { env } from "./env";

declare global {
  // dev 핫리로드 때 커넥션이 무한 증식하지 않도록 전역에 1개만 유지
  var __precase_sql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  globalThis.__precase_sql ??
  postgres(env.DATABASE_URL, {
    // Supabase Supavisor **트랜잭션 모드**(6543) 경유.
    //
    // 세션 모드(5432)를 쓰면 클라이언트마다 연결을 붙들어서 pool_size 15에서 막힌다
    // (`EMAXCONNSESSION`). Vercel은 함수 인스턴스가 여럿이고 각자 풀을 만들므로
    // 인스턴스 3~4개만 떠도 한도에 닿는다 — 실측으로 확인했다(2026.08.23).
    // Supabase 문서도 「서버리스·엣지 함수처럼 수명이 짧은 클라이언트에는
    // 트랜잭션 모드를 쓰라」고 권고한다.
    //
    // ⚠️ 트랜잭션 모드는 prepared statement를 지원하지 않는다. 끄지 않으면
    //    질의가 실패한다.
    prepare: false,
    // 인스턴스마다 풀이 생기므로 작게 잡는다.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__precase_sql = sql;
}
