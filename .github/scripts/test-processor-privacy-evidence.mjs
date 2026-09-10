// B-PROCESSOR-PRIVACY·B-PRIVACY-VERCEL inventory 계약 시험. 외부 호출을 하지 않는다.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  FORMULA_VERSION, INVENTORY_PATH, blockersReadyForPass, validateProcessorPrivacyInventory,
} from './processor-privacy-policy.mjs';

const root = process.cwd();
const run = (repository) => { const errors = []; const coverage = validateProcessorPrivacyInventory(repository, (e) => errors.push(e)); return { errors, coverage }; };

// 현재 저장소의 inventory 는 형식을 모두 만족하고, 아직 아무 축도 관측되지 않았다.
const actual = run(root);
assert.deepEqual(actual.errors, [], `현재 inventory 형식 오류: ${actual.errors.join(', ')}`);
assert.deepEqual(Object.keys(actual.coverage).sort(), ['B-PRIVACY-VERCEL', 'B-PROCESSOR-PRIVACY']);
for (const [blockerId, value] of Object.entries(actual.coverage)) {
  assert.ok(value.applicable > 0, `${blockerId} 의 확인 대상 축이 없다`);
  assert.equal(value.observed, 0, `${blockerId} 는 아직 관측된 축이 없어야 한다`);
  assert.equal(value.coverage, 0);
}
assert.deepEqual(blockersReadyForPass(actual.coverage), [], '관측 없이 PASS 후보가 됐다');

// 합성 저장소를 만들어 변조를 넣는다. 실제 저장소 파일은 건드리지 않는다.
const sandbox = mkdtempSync(resolve(tmpdir(), 'finshield-privacy-'));
const write = (inventory) => {
  const target = resolve(sandbox, INVENTORY_PATH);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(inventory, null, 2)}\n`);
};
const base = () => JSON.parse(readFileSync(resolve(root, INVENTORY_PATH), 'utf8'));
const firstItem = (inventory, id, axis) => inventory.processors.find((p) => p.id === id).items.find((i) => i.axis === axis);

try {
  // 관측 파일이 실제로 있으면 OBSERVED 가 통과하고 coverage 가 오른다.
  const observed = base();
  mkdirSync(resolve(sandbox, 'evidence/development/privacy'), { recursive: true });
  cpSync(resolve(root, 'evidence/development/privacy/2026-09-07-cohere-settings.json'),
    resolve(sandbox, 'evidence/development/privacy/2026-09-07-cohere-settings.json'));
  const item = firstItem(observed, 'cohere', 'training_use');
  item.status = 'OBSERVED';
  item.evidence = 'evidence/development/privacy/2026-09-07-cohere-settings.json';
  item.observed_on = '2026-09-07';
  item.method = '로그인된 Dashboard 의 표시된 UI 읽기';
  write(observed);
  const good = run(sandbox);
  assert.deepEqual(good.errors, []);
  assert.equal(good.coverage['B-PROCESSOR-PRIVACY'].observed, 1);
  assert.notEqual(good.coverage['B-PROCESSOR-PRIVACY'].coverage, 1);
  assert.deepEqual(blockersReadyForPass(good.coverage), []);

  const mutations = [
    ['버전 변조', (i) => i.version = 'other'],
    ['상태 목록 변조', (i) => i.statuses = ['OBSERVED']],
    ['확인 주체 목록 변조', (i) => i.actors = ['account-owner']],
    ['처리자 중복', (i) => i.processors.push(structuredClone(i.processors[0]))],
    ['축 누락', (i) => i.processors[0].items.pop()],
    ['허용 밖 상태', (i) => firstItem(i, 'anthropic', 'retention').status = 'PASS'],
    ['허용 밖 확인 주체', (i) => firstItem(i, 'anthropic', 'retention').actor = 'someone'],
    ['확인 내용 비움', (i) => firstItem(i, 'anthropic', 'retention').required = ''],
    ['근거 없는 확인됨', (i) => firstItem(i, 'anthropic', 'dpa').status = 'OBSERVED'],
    ['미확인인데 근거 채움', (i) => firstItem(i, 'anthropic', 'region').evidence = 'evidence/x.json'],
    ['해당 없음인데 근거 채움', (i) => firstItem(i, 'supabase', 'training_use').observed_on = '2026-09-10'],
    ['없는 관측 파일', (i) => {
      const target = firstItem(i, 'clova', 'retention');
      target.status = 'OBSERVED'; target.evidence = 'evidence/not-there.json';
      target.observed_on = '2026-09-10'; target.method = '읽기';
    }],
    ['경로 탈출', (i) => {
      const target = firstItem(i, 'clova', 'region');
      target.status = 'OBSERVED'; target.evidence = 'evidence/../../etc/passwd';
      target.observed_on = '2026-09-10'; target.method = '읽기';
    }],
    ['저장소 밖 경로', (i) => {
      const target = firstItem(i, 'clova', 'dpa');
      target.status = 'OBSERVED'; target.evidence = 'docs/ops/local-environment.md';
      target.observed_on = '2026-09-10'; target.method = '읽기';
    }],
    ['관측일 형식 오류', (i) => {
      const target = firstItem(i, 'vercel', 'region');
      target.status = 'OBSERVED'; target.evidence = 'evidence/development/privacy/2026-09-07-cohere-settings.json';
      target.observed_on = '2026/09/10'; target.method = '읽기';
    }],
    ['blocker 가 없는 처리자 참조', (i) => i.blockers['B-PROCESSOR-PRIVACY'].push('missing')],
  ];
  for (const [label, mutate] of mutations) {
    const inventory = base();
    mutate(inventory);
    write(inventory);
    assert.ok(run(sandbox).errors.length > 0, `변조를 거부하지 못했다: ${label}`);
  }

  // 모든 축을 근거 없이 확인됨으로 바꿔도 통과하지 못한다.
  const declared = base();
  for (const processor of declared.processors) {
    for (const item of processor.items) if (item.status !== 'NOT_APPLICABLE') item.status = 'OBSERVED';
  }
  write(declared);
  const declaredRun = run(sandbox);
  assert.ok(declaredRun.errors.length > 0);
  assert.deepEqual(blockersReadyForPass(declaredRun.coverage), []);

  console.log(`처리자 개인정보 inventory 계약과 변조 ${mutations.length + 1}건 거부를 확인했다. 현재 관측 축은 0개다.`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

assert.equal(FORMULA_VERSION, 'processor-privacy-inventory-v1');
