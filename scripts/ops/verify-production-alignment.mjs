/** N-OPS-005·SEC-OPS-004: 운영 승격 전 읽기 전용 DB/실행 버전 대조. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { collectSchemaDigests, collectRemoteObservations, evaluateRemoteObservations } from '../../supabase/tests/verify-remote.mjs';

const schemas = "('public','private','kb','demo')";
const configKeys = ['columns','triggers','enums','execute','manifest','agents','tools','allowlists','kb_release','policies'];
const digestKeys = ['tables_digest','constraint_digest','index_digest','routine_digest','view_digest','policy_digest'];
export function evaluateAlignment({ baseline, observed, configMatches, runtime, expectedSha, now = Date.now() }) {
  const failures = evaluateRemoteObservations(observed);
  for (const key of digestKeys) if (!baseline[key] || baseline[key] !== observed.schema[key]) failures.push(`SCHEMA:${key}`);
  for (const key of configKeys) if (configMatches[key] !== true) failures.push(`CONFIG:${key}`);
  if (!/^[a-f0-9]{40}$/.test(expectedSha) || runtime.vercel_commit_sha !== expectedSha) failures.push('DEPLOYMENT_SHA');
  if (runtime.vercel_env !== 'production' || runtime.vercel_region !== 'icn1' || runtime.node_major !== 24 || !runtime.vercel_deployment_id) failures.push('DEPLOYMENT_RUNTIME');
  const age = now - Date.parse(runtime.observed_at);
  if (!Number.isFinite(age) || age < -30000 || age > 300000) failures.push('DEPLOYMENT_STALE');
  return failures;
}
const quote = v => Array.isArray(v) ? 'ARRAY[' + v.map(quote).join(',') + ']' : "'" + String(v).replaceAll("'", "''") + "'";
// 격리 DB의 owner DSN을 새로 만들지 않고 기존 컨테이너의 로컬 socket으로 읽는다.
function dockerSql(container, database) {
  let searchPath = 'public';
  const query = q => JSON.parse(execFileSync('docker', ['exec','-i',container,'psql','-X','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1'], {
    input: `set search_path=${searchPath}; select coalesce(json_agg(t),'[]'::json) from (${q}) t;`, encoding:'utf8', stdio:['pipe','pipe','pipe'], maxBuffer:16*1024*1024,
  }).trim());
  const sql = (strings,...values) => Promise.resolve(query(strings.reduce((s,part,i)=>s+part+(i<values.length?quote(values[i]):''),'')));
  sql.unsafe = q => Promise.resolve(/^set /i.test(q) ? [] : query(q));
  sql.begin = async fn => {
    searchPath = 'pg_catalog';
    try { return await fn(Object.assign((s,...v)=>/^set /i.test(s[0]) ? Promise.resolve([]) : sql(s,...v), {unsafe:sql.unsafe})); }
    finally { searchPath = 'public'; }
  };
  return sql;
}
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function configuration(sql, version) {
  const queries = {
    columns: `select n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) as expression from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ${schemas} and c.relkind in ('r','p','v') and a.attnum>0 and not a.attisdropped order by 1,2,3`,
    triggers: `select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and not t.tgisinternal order by 1,2,3`,
    enums: `select n.nspname,t.typname,e.enumsortorder,e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in ${schemas} order by 1,2,3`,
    execute: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,r.rolname,has_function_privilege(r.rolname,p.oid,'EXECUTE') as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r where n.nspname in ${schemas} and p.prokind in ('f','p') and r.rolname in ('anon','authenticated','finshield_worker') order by 1,2,3,4`,
    manifest: `select (to_jsonb(m)-'id'-'created_at'-'kb_release_id')::text as definition from private.execution_manifests m where manifest_version=${quote(version)}`,
    kb_release: `select (to_jsonb(k)-'id'-'created_at')::text as definition from kb.kb_releases k join private.execution_manifests m on m.kb_release_id=k.id where m.manifest_version=${quote(version)}`,
    policies: `select (to_jsonb(p)-'id'-'created_at')::text as definition from private.policy_versions p join private.execution_manifests m on (p.policy_type,p.version) in (('EVIDENCE',m.evidence_policy_version),('RESULT_MATRIX',m.result_matrix_version),('COVERAGE',m.coverage_contract_version),('PROFILE',m.profile_policy_version),('PII',m.pii_policy_version)) where m.manifest_version=${quote(version)} order by p.policy_type,p.version`,
    agents: `select (to_jsonb(a)-'id'-'created_at')::text as definition,ma.logical_agent_key,ma.required,ma.parallel_group from private.execution_manifest_agents ma join private.execution_manifests m on m.id=ma.execution_manifest_id join private.agent_definitions a on a.id=ma.agent_definition_id where m.manifest_version=${quote(version)} order by a.agent_code`,
    tools: `select (to_jsonb(t)-'id'-'created_at')::text as definition,mt.purpose_code,mt.required from private.execution_manifest_tools mt join private.execution_manifests m on m.id=mt.execution_manifest_id join private.tool_definitions t on t.id=mt.tool_definition_id where m.manifest_version=${quote(version)} order by t.tool_code,mt.purpose_code`,
    allowlists: `select a.agent_code,a.version,t.tool_code,t.version as tool_version,l.purpose_code from private.agent_tool_allowlists l join private.agent_definitions a on a.id=l.agent_definition_id join private.tool_definitions t on t.id=l.tool_definition_id join private.execution_manifest_agents ma on ma.agent_definition_id=a.id join private.execution_manifests m on m.id=ma.execution_manifest_id where m.manifest_version=${quote(version)} order by 1,2,3,4,5`,
  };
  return sql.begin(async tx => {
    await tx`set local search_path=pg_catalog`;
    const result = {};
    for (const [key,q] of Object.entries(queries)) { const rows = await tx.unsafe(q); result[key]={count:rows.length,digest:sha256(rows)}; }
    return result;
  });
}
async function main() {
  const {values:o} = parseArgs({options:Object.fromEntries(['database-env-file','container','database','runtime-file','expected-sha','output'].map(k=>[k,{type:'string'}]))});
  if (Object.values(o).length!==6 || !o.output) throw Error('ARGUMENTS_REQUIRED');
  const env=parseEnv(readFileSync(o['database-env-file'],'utf8'));
  const dsn=env.DATABASE_URL;const target=new URL(dsn);
  if (target.username!=='finshield_worker.exarejrwvjochjdminzo' || !target.hostname.endsWith('.pooler.supabase.com') || target.port!=='6543') throw Error('WRONG_DATABASE_TARGET');
  const version=readFileSync(new URL('../../src/lib/finshield/manifest.ts',import.meta.url),'utf8').match(/export const MANIFEST_VERSION = "([^"]+)"/)?.[1];
  if (!version) throw Error('MANIFEST_VERSION_MISSING');
  const local=dockerSql(o.container,o.database);const remote=postgres(dsn,{prepare:false,max:1});
  try {
    const baseline=await collectSchemaDigests(local);const observed=await collectRemoteObservations(dsn);
    const localConfig=await configuration(local,version);const remoteConfig=await configuration(remote,version);
    const configMatches=Object.fromEntries(Object.keys(localConfig).map(k=>[k,localConfig[k].count>0 && JSON.stringify(localConfig[k])===JSON.stringify(remoteConfig[k])]));
    const runtime=JSON.parse(readFileSync(o['runtime-file'],'utf8'));
    const report={checked_at:new Date().toISOString(),expectedSha:o['expected-sha'],manifest_version:version,baseline,observed,localConfig,remoteConfig,configMatches,runtime};
    report.failures=evaluateAlignment({...report,expectedSha:o['expected-sha']});
    writeFileSync(o.output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({ok:report.failures.length===0,failures:report.failures,configMatches}));
    if (report.failures.length) process.exitCode=1;
  } finally { await remote.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error=>{
  // DB 에러의 detail·query·DSN은 출력하지 않는다.
  console.error(JSON.stringify({ok:false,code:/^[A-Z_0-9]+$/.test(error.message)?error.message:error.code??'ALIGNMENT_CHECK_FAILED'}));process.exitCode=1;
});
