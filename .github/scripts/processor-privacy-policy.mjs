// B-PROCESSOR-PRIVACY·B-PRIVACY-VERCEL: 처리자별 계약·계정 조건 inventory 를 fail-closed 로 검사한다.
// 공식 문서 링크나 기억은 관측이 아니다. OBSERVED 는 저장소 안의 관측 파일과 관측일이 있을 때만 허용한다.
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';

export const FORMULA_VERSION = 'processor-privacy-inventory-v1';
export const INVENTORY_PATH = '.github/fixtures/processor-privacy/inventory.json';

const STATUSES = Object.freeze(['OBSERVED', 'UNVERIFIED', 'NOT_APPLICABLE']);
const ACTORS = Object.freeze(['account-owner', 'repository']);
const ITEM_KEYS = Object.freeze(['axis', 'status', 'actor', 'evidence', 'observed_on', 'method', 'required']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * inventory 를 읽고 형식·축 누락·관측 근거를 검사한다.
 * 반환값은 blocker 별 coverage 다. coverage 가 1 이 아니면 그 blocker 는 PASS 후보가 아니다.
 */
export function validateProcessorPrivacyInventory(repository, fail) {
  const path = resolve(repository, INVENTORY_PATH);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) { fail('처리자 개인정보 inventory 파일이 없습니다.'); return null; }
  let inventory;
  try { inventory = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('inventory 가 올바른 JSON 이 아닙니다.'); return null; }

  if (!exact(inventory, ['version', 'note', 'statuses', 'actors', 'blockers', 'axes', 'processors'])
    || inventory.version !== FORMULA_VERSION
    || JSON.stringify(inventory.statuses) !== JSON.stringify([...STATUSES])
    || JSON.stringify(inventory.actors) !== JSON.stringify([...ACTORS])) {
    fail('inventory 형식이 계약과 다릅니다.'); return null;
  }

  const byId = new Map();
  for (const processor of inventory.processors ?? []) {
    if (!exact(processor, ['id', 'label', 'items']) || !nonEmpty(processor.id) || !nonEmpty(processor.label)) {
      fail('처리자 항목 형식이 계약과 다릅니다.'); return null;
    }
    if (byId.has(processor.id)) { fail(`처리자 ${processor.id} 가 중복됐습니다.`); return null; }
    byId.set(processor.id, processor);
  }

  const coverage = {};
  for (const [blockerId, processorIds] of Object.entries(inventory.blockers ?? {})) {
    let total = 0, observed = 0, applicable = 0;
    for (const processorId of processorIds) {
      const processor = byId.get(processorId);
      if (!processor) { fail(`blocker ${blockerId} 가 가리키는 처리자 ${processorId} 가 없습니다.`); continue; }
      const axes = inventory.axes?.[processorId] ?? inventory.axes?.default;
      if (!Array.isArray(axes) || axes.length === 0) { fail(`처리자 ${processorId} 의 축 목록이 없습니다.`); continue; }
      const seen = new Set();
      for (const item of processor.items ?? []) {
        if (!exact(item, ITEM_KEYS) || !axes.includes(item.axis) || seen.has(item.axis)) {
          fail(`처리자 ${processorId} 의 항목 형식 또는 축이 계약과 다릅니다.`); continue;
        }
        seen.add(item.axis);
        if (!STATUSES.includes(item.status)) { fail(`처리자 ${processorId} 의 ${item.axis} 상태가 허용 값 밖입니다.`); continue; }
        if (!ACTORS.includes(item.actor)) { fail(`처리자 ${processorId} 의 ${item.axis} 확인 주체가 허용 값 밖입니다.`); continue; }
        if (!nonEmpty(item.required)) fail(`처리자 ${processorId} 의 ${item.axis} 에 확인해야 할 내용이 없습니다.`);
        total += 1;
        if (item.status === 'NOT_APPLICABLE') {
          // 해당 없음도 근거 없이 늘릴 수 없다. 왜 해당 없는지를 required 에 적는다.
          if (item.evidence !== null || item.observed_on !== null || item.method !== null) {
            fail(`처리자 ${processorId} 의 ${item.axis} 는 해당 없음인데 관측 항목이 채워져 있습니다.`);
          }
          continue;
        }
        applicable += 1;
        if (item.status === 'UNVERIFIED') {
          if (item.evidence !== null || item.observed_on !== null || item.method !== null) {
            fail(`처리자 ${processorId} 의 ${item.axis} 는 미확인인데 관측 항목이 채워져 있습니다.`);
          }
          continue;
        }
        // OBSERVED 는 저장소 안의 실제 관측 파일과 관측일, 관측 방법이 모두 있어야 한다.
        if (!nonEmpty(item.evidence) || !nonEmpty(item.method) || !ISO_DATE.test(item.observed_on ?? '')) {
          fail(`처리자 ${processorId} 의 ${item.axis} 가 관측 근거 없이 확인됨으로 적혀 있습니다.`); continue;
        }
        if (item.evidence.includes('..') || !item.evidence.startsWith('evidence/')) {
          fail(`처리자 ${processorId} 의 ${item.axis} 관측 근거 경로가 허용 범위 밖입니다.`); continue;
        }
        const evidencePath = resolve(repository, item.evidence);
        if (!existsSync(evidencePath) || lstatSync(evidencePath).isSymbolicLink() || !lstatSync(evidencePath).isFile()) {
          fail(`처리자 ${processorId} 의 ${item.axis} 관측 파일이 저장소에 없습니다.`); continue;
        }
        observed += 1;
      }
      for (const axis of axes) if (!seen.has(axis)) fail(`처리자 ${processorId} 의 축 ${axis} 항목이 없습니다.`);
    }
    // 해당 없음을 제외한 축이 모두 관측돼야 coverage 가 1 이다. 분모가 0이면 N/A 로 남긴다.
    coverage[blockerId] = { total, applicable, observed, coverage: applicable === 0 ? null : observed / applicable };
  }
  return coverage;
}

/** coverage 가 1 이 아닌 blocker 는 PASS 를 주장할 수 없다. */
export function blockersReadyForPass(coverage) {
  return Object.entries(coverage ?? {})
    .filter(([, value]) => value.coverage === 1)
    .map(([blockerId]) => blockerId)
    .sort();
}
