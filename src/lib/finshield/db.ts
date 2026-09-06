/**
 * FinShield 스키마 연결 — `finshield_worker` 역할 전용.
 *
 * 이 역할은 NOBYPASSRLS 이고 소유자 표(`public.case_inputs`,
 * `private.input_objects`, `public.claims` 등)를 직접 읽거나 쓰지 못한다.
 * 그 표에 손대는 일은 전부 `private.*` SECURITY DEFINER 함수로 한다.
 * 함수를 거치지 않는 질의가 42501 로 막히는 것은 설계이지 장애가 아니다.
 *
 * 들여온 PreCase Runtime 의 `src/lib/db.ts`는 옛 스키마와 `app_runtime`
 * 역할을 본다. 두 연결을 섞지 않는다.
 */

import "server-only";
import postgres from "postgres";
import { finshieldEnv } from "./env";

declare global {
  // dev 핫리로드에서 커넥션이 증식하지 않도록 전역에 하나만 둔다.
  var __finshield_sql: ReturnType<typeof postgres> | undefined;
}

// 연결은 처음 쓸 때 연다. 모듈을 읽는 순간 열면 빌드가 DSN 을 요구하게 된다.
export const fsql = (): ReturnType<typeof postgres> => {
  if (globalThis.__finshield_sql) return globalThis.__finshield_sql;
  const client = postgres(finshieldEnv().FINSHIELD_DATABASE_URL, {
    // Supavisor 트랜잭션 모드는 prepared statement 를 지원하지 않는다.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  globalThis.__finshield_sql = client;
  return client;
};
