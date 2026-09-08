import { describe, expect, it } from 'vitest';
import { evaluateAlignment } from '../../../../scripts/ops/verify-production-alignment.mjs';
import observation from '../../../../evidence/development/deployment/2026-09-08-db-alignment/production-preflight.json';

const sample = () => ({ ...structuredClone(observation), now: Date.parse(observation.runtime.observed_at) });
describe('운영 승격 전 DB·Manifest·배포 대조', () => {
  it('실제 복구 후 일치한 관측을 허용한다', () => {
    expect(evaluateAlignment(sample())).toEqual([]);
  });
  it('테이블이 같아도 재시도 함수 누락과 v7 설정 누락은 차단한다', () => {
    const state = sample();
    state.observed.schema.routine_digest = 'missing-retry-function';
    state.configMatches.manifest = false;
    expect(evaluateAlignment(state)).toEqual(expect.arrayContaining(['SCHEMA:routine_digest', 'CONFIG:manifest']));
  });
  it('실행 연결·권한 검사 누락을 통과로 해석하지 않는다', () => {
    const state = sample();
    expect(evaluateAlignment({ ...state, configMatches: {} })).toEqual(expect.arrayContaining(['CONFIG:execute','CONFIG:tools','CONFIG:kb_release']));
  });
  it('이전 배포나 다른 환경 및 오래된 관측을 거부한다', () => {
    const state = sample();
    state.runtime.vercel_commit_sha = 'a'.repeat(40);
    state.runtime.vercel_env = 'preview';
    state.now += 300001;
    expect(evaluateAlignment(state)).toEqual(expect.arrayContaining(['DEPLOYMENT_SHA','DEPLOYMENT_RUNTIME','DEPLOYMENT_STALE']));
  });
});
