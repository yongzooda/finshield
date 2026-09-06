/**
 * GET /api/runtime-manifest — 실행 Runtime 관측 endpoint.
 *
 * ADR 8.2가 Vercel의 Node를 `24.x` major로만 고정하고 minor·patch는 플랫폼
 * 갱신에 따라 달라진다고 적어 두었다. 그래서 각 Run manifest에 실제
 * `process.version`과 deployment ID와 region을 남기라고 요구한다.
 * `B-RUNTIME-01`은 그 값을 배포 안에서 직접 읽어 증거로 남긴다.
 *
 * 밖에서는 알 수 없는 값이라 배포 안에 endpoint가 필요하다. GitHub Actions에서
 * `process.version`을 읽으면 Actions runner의 Node를 재게 된다.
 *
 * 여기서 내보내는 값은 전부 비밀이 아니다. deployment ID는 Vercel이 이미 모든
 * 응답의 `x-vercel-id` header에 넣어 보낸다. 그 밖의 환경변수는 읽지 않는다.
 * Implementation Gate가 `NO-GO`인 동안에도 관측성 작업은 허용된다 (ADR 20).
 */

import { jsonNoStore } from "@/lib/ops/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NODE_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

export async function GET(): Promise<Response> {
  const match = NODE_VERSION_PATTERN.exec(process.version);
  return jsonNoStore({
    schema_version: "1",
    node_version: process.version,
    node_major: match ? Number(match[1]) : null,
    node_minor: match ? Number(match[2]) : null,
    node_patch: match ? Number(match[3]) : null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    vercel_region: process.env.VERCEL_REGION ?? null,
    vercel_deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    vercel_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    observed_at: new Date().toISOString(),
  }, 200);
}
