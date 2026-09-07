// 합성 격리 DB에서만 실행한다. 원격 DSN·Provider를 사용하지 않는다.
import postgres from 'postgres';
import assert from 'node:assert/strict';
const sql = postgres('postgres://postgres:local@127.0.0.1:55437/finshield_account_deletion', { max: 3 });
const owner = 'dc674cb6-49ad-4133-9999-ccc008000003';
try {
  await sql`insert into auth.users(id) values(${owner})`;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let inserted;
  const started = new Promise(resolve => { inserted = resolve; });
  const creation = sql.begin(async tx => {
    await tx`select private.create_case(${owner}::uuid,'LOAN','합성 경합 시험','race-before',${'a'.repeat(64)})`;
    inserted(); await barrier;
  });
  await started;
  let accepted = false;
  const deletion = sql`select private.request_account_deletion(${owner}::uuid,${'b'.repeat(64)},${'c'.repeat(64)}) as id`.then(rows => { accepted = true; return rows[0].id; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(accepted, false, '선행 작업 commit 전에 탈퇴가 통과하면 안 된다');
  release(); await creation;
  const request = await deletion;
  const [existing] = await sql`select deleted_at from public.financial_cases where owner_id=${owner}`;
  assert.ok(existing.deleted_at, '경합한 선행 Case도 차단해야 한다');
  await assert.rejects(sql`select private.create_case(${owner}::uuid,'LOAN','합성 거부 시험','race-after',${'d'.repeat(64)})`, e => e.code === '55000' && e.message === 'ACCOUNT_DELETING');
  const [context] = await sql`select private.account_cleanup_context(${request}::uuid) as value`;
  const [child] = await sql`select private.request_case_deletion(${owner}::uuid,${context.value.case_id}::uuid,'race-cleanup',${'e'.repeat(64)},${'f'.repeat(64)},'k1','deletion-policy-v1') as id`;
  await sql`select private.purge_case(${child.id}::uuid)`;
  assert.equal((await sql`select private.finish_account_deletion(${request}::uuid) as ok`)[0].ok, true);
  console.log(JSON.stringify({ test: 'account-deletion-creation-race', passed: true, new_work_rejected: true, preceding_work_blocked: true, auth_absent: (await sql`select id from auth.users where id=${owner}`).length === 0 }));
} finally { await sql.end(); }
