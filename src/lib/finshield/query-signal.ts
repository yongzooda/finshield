/** E-008·N-PERF-009: Abort를 실제 PostgreSQL cancel 요청까지 전달한다. */
export async function queryWithSignal<T>(query: PromiseLike<T> & { cancel: () => void }, signal: AbortSignal = AbortSignal.timeout(3000)): Promise<T> {
  signal?.throwIfAborted();
  const cancel = () => { void Promise.resolve(query.cancel()).catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try { const result = await query; signal?.throwIfAborted(); return result; }
  finally { signal?.removeEventListener("abort", cancel); }
}
