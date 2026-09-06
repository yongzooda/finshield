/**
 * FinShield 전용 환경변수.
 *
 * 기존 `src/lib/env.ts`는 들여온 PreCase Runtime 이 쓰는 값을 담고 있고,
 * 채택된 `B-LAW-01` 증거의 scope 안에 있다. 거기에 값을 더하면 그 증거가
 * 무효가 되므로 FinShield 가 쓰는 값은 이 모듈에서 따로 검사한다.
 *
 * 이 모듈이 여는 연결은 `finshield_worker` 역할이다. 그 역할은 RLS 를
 * 우회하지 않고 소유자 표에 직접 쓰지 못한다. 쓰기는 전부 함수로 한다.
 *
 * 검사는 처음 쓸 때 한다. 모듈을 읽는 순간 던지면 빌드가 실행 시점 값을
 * 요구하게 된다. 빌드는 비밀 없이도 끝나야 한다.
 */

import "server-only";
import { z } from "zod";

const schema = z.object({
  // 운영 Supabase 의 Supavisor 트랜잭션 모드 주소다. 세션 모드를 쓰면 안 된다.
  FINSHIELD_DATABASE_URL: z.string().min(1),
  // 회원 경로에 쓰는 공개 키와 주소. 서버 키는 삭제·임시물 쓰기에만 쓴다.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
});

export type FinshieldEnv = z.infer<typeof schema>;

let cached: FinshieldEnv | null = null;

export const finshieldEnv = (): FinshieldEnv => {
  if (cached) return cached;
  const parsed = schema.safeParse({
    FINSHIELD_DATABASE_URL: process.env.FINSHIELD_DATABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  if (!parsed.success) {
    // 값 자체는 절대 찍지 않는다. 어떤 이름이 비었는지만 남긴다.
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`FinShield 환경변수가 유효하지 않다: ${missing}`);
  }
  cached = parsed.data;
  return cached;
};

/** 인증 설정이 갖춰졌는지만 본다. 없으면 화면이 그 사실을 알린다. */
export const authConfigured = (): boolean =>
  Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
