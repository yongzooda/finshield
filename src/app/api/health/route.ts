/** N-AVL-001: 앱·핵심 DB만 검사한다. 외부 Provider 상태는 최근 관측 Cache로 구분한다. */
import { fsql } from "@/lib/finshield/db";
import { checkHealth, healthHttpStatus } from "@/lib/finshield/health-status.mjs";
import { jsonNoStore } from "@/lib/ops/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const report = await checkHealth({ databaseCheck: async signal => {
    const query = fsql()`select 1`;
    const cancel = () => { void query.cancel(); };
    signal.addEventListener("abort", cancel, {once:true});
    try { signal.throwIfAborted(); await query; }
    finally { signal.removeEventListener("abort", cancel); }
  } });
  return jsonNoStore(report, healthHttpStatus(report, new URL(req.url).searchParams.get("strict") === "1"));
}
