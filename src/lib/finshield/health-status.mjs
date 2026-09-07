// N-AVL-001: 외부 조회는 이 모듈의 책임이 아니다. 실제 호출자가 남긴 상태만 읽는다.
export const PROVIDERS = Object.freeze(['anthropic', 'cohere', 'clova', 'law']);
export const CACHE_TTL_MS = 300_000;
export const DB_TIMEOUT_MS = 1500;

export function createProviderStatusCache(clock = Date.now) {
  const entries = new Map();
  return {
    observe(provider, available) {
      if (!PROVIDERS.includes(provider) || typeof available !== 'boolean') throw new Error('HEALTH_OBSERVATION_INVALID');
      entries.set(provider, { available, observed: clock() });
    },
    snapshot() {
      const now = clock();
      return PROVIDERS.map(provider => {
        const entry = entries.get(provider);
        const fresh = entry && now >= entry.observed && now - entry.observed < CACHE_TTL_MS;
        return { provider, status: fresh ? (entry.available ? 'available' : 'unavailable') : 'unknown',
          observed_at: entry ? new Date(entry.observed).toISOString() : null,
          cache_state: !entry ? 'unobserved' : fresh ? 'fresh' : 'expired' };
      });
    },
  };
}

export const providerStatusCache = createProviderStatusCache();

export async function checkHealth({ databaseCheck, cache = providerStatusCache, timeoutMs = DB_TIMEOUT_MS }) {
  const started = performance.now();
  const abort = new AbortController();
  let timer;
  let database;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new Error('HEALTH_DB_TIMEOUT')); }, timeoutMs);
    });
    await Promise.race([Promise.resolve().then(() => databaseCheck(abort.signal)), timeout]);
    database = { name: 'db', ok: true, ms: Math.round(performance.now() - started) };
  } catch {
    database = { name: 'db', ok: false, ms: Math.round(performance.now() - started),
      detail: abort.signal.aborted ? 'TIMEOUT' : 'UNAVAILABLE' };
  } finally { clearTimeout(timer); }
  const providers = cache.snapshot();
  const status = !database.ok ? 'down' : providers.every(p => p.status === 'available') ? 'ok' : 'degraded';
  return { status, checks: [database], providers, checkedAt: new Date().toISOString() };
}

export function healthHttpStatus(report, strict = false) {
  return report.status === 'down' || (strict && report.status !== 'ok') ? 503 : 200;
}
