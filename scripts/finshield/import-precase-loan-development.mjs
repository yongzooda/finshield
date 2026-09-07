// 기존 PreCase는 읽기만 한다. 평가셋을 읽지 않고 corpus의 대출 분류 자료만 격리 DB에 적재한다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { gateForModel } from '../../src/lib/agents/pii.ts';
const COMMIT = '12fd89cdac81747a9c3ba7b4b71a408013f8559a';
const RELEASE = 'precase-loan-development-12fd89c';
const hash = value => createHash('sha256').update(value).digest('hex');
const download = name => JSON.parse(execFileSync('gh', ['api','-H','Accept: application/vnd.github.raw+json',
  `repos/yongzooda/precase/contents/measure/experiment/data/${name}?ref=${COMMIT}`], { encoding:'utf8',maxBuffer:10*1024*1024 }));
const target = new URL(process.env.FINSHIELD_KB_IMPORT_DATABASE_URL ?? 'postgres://postgres:local@127.0.0.1:55437/finshield_account_deletion');
if (target.hostname !== '127.0.0.1' || target.port !== '55437' || target.pathname !== '/finshield_account_deletion') throw new Error('ISOLATED_FINSHIELD_DB_REQUIRED');
const corpus = download('corpus.json'), labels = download('labels_v1.json');
const corpusIds = new Set(corpus.map(row=>row.id));
const loanIds = new Set(labels.filter(row => corpusIds.has(row.id) && row.ok && row.product_code === 'BNK_LOAN').map(row => row.id));
let piiBlocked = 0, sourceUnresolved = 0;
const records = corpus.filter(row => loanIds.has(row.id)).flatMap(row => {
  const post = /^(\d+)_/.exec(row.id)?.[1];
  if (!post) { sourceUnresolved++; return []; }
  const gate = gateForModel(row.text);
  if (!gate.ok) { piiBlocked++; return []; }
  // 정책상 원본 FSS 재확인·라이선스 확인 전에는 완전한 직접 근거로 쓰지 않는다.
  return [{ id:row.id, text:gate.masked.text, originalHash:hash(row.text), post,
    source:`https://www.fss.or.kr/fss/bbs/B0000390/view.do?nttId=${post}&menuNo=200497&pageIndex=1` }];
});
const chunks = record => Array.from({length:Math.ceil(record.text.length/1800)},(_,i)=>({text:record.text.slice(i*1800,(i+1)*1800),start:i*1800,end:Math.min(record.text.length,(i+1)*1800)}));
const sql = postgres(target.toString(), { max:1,onnotice:()=>{} });
try {
  const releaseId = await sql.begin(async tx => {
    const expectedHash = hash(JSON.stringify(records.map(r=>[r.id,r.originalHash])));
    const existing = await tx`select id,manifest_hash from kb.kb_releases where version=${RELEASE}`;
    if (existing.length) {
      if (existing[0].manifest_hash!==expectedHash) throw new Error('KB_RELEASE_CONTENT_CHANGED');
      return existing[0].id;
    }
    const [release] = await tx`insert into kb.kb_releases(version,corpus_scope,document_count,chunk_count,manifest_hash)
      values(${RELEASE},${tx.json({schema_version:'1',scenario:'LOAN',source_commit:COMMIT,development_only:true,source_original_verified:false,license_verified:false})},
        ${records.length},${records.reduce((n,r)=>n+chunks(r).length,0)},${hash(JSON.stringify(records.map(r=>[r.id,r.originalHash])))}) returning id`;
    for (const record of records) {
      const officialId=`precase:${record.post}:${hash(record.id).slice(0,16)}`;
      const [snapshot]=await tx`insert into kb.source_snapshots(source_type,authority_level,publisher_name,source_title,canonical_url,official_id,retrieved_at,source_version,content_hash,source_fingerprint,freshness_status,is_complete,is_citable)
        values('DISPUTE','C','금융감독원 자료의 PreCase 추출본',${record.id},${record.source},${officialId},now(),${COMMIT},${record.originalHash},${hash(record.source)},'UNKNOWN',false,false)
        on conflict(source_type,official_id,source_version,content_hash) do nothing returning id`;
      const snapshotId = snapshot?.id ?? (await tx`select id from kb.source_snapshots where official_id=${officialId} and source_version=${COMMIT} and content_hash=${record.originalHash}`)[0].id;
      await tx`insert into kb.kb_release_sources(kb_release_id,source_snapshot_id,purpose_code) values(${release.id},${snapshotId},'HISTORICAL_REFERENCE')`;
      const [document]=await tx`insert into kb.knowledge_documents(kb_release_id,source_snapshot_id,document_key,document_version,document_type,title,publisher,scenario_codes,product_codes,institution_codes,channel_codes,source_url,ingested_at,content_hash,normalization_version)
        values(${release.id},${snapshotId},${officialId},${COMMIT},'PRECASE_CASE',${record.id},'금융감독원 자료의 PreCase 추출본',array['LOAN'],array['BNK_LOAN'],array[]::text[],array[]::text[],${record.source},now(),${hash(record.text)},'pii-text-chunk-v1') returning id`;
      let no=0;
      for (const chunk of chunks(record)) await tx`insert into kb.knowledge_chunks(kb_release_id,knowledge_document_id,chunk_no,chunk_text,source_locator,metadata,token_count,content_hash)
        values(${release.id},${document.id},${++no},${chunk.text},${tx.json({schema_version:'1',kind:'precase_extracted_text',offset_basis:'MASKED_TEXT',normalization_version:'pii-text-chunk-v1',source_file:record.id,char_start:chunk.start,char_end:chunk.end,source_commit:COMMIT})},
          ${tx.json({schema_version:'1',reference_only:true,original_body_complete:false})},${Buffer.byteLength(chunk.text)},${hash(chunk.text)})`;
    }
    await tx`insert into kb.kb_release_events(kb_release_id,event_type,reason_code) values(${release.id},'PUBLISHED','ISOLATED_DEVELOPMENT_ONLY')`;
    return release.id;
  });
  console.log(JSON.stringify({release_id:releaseId,source_commit:COMMIT,source_records:corpus.length,loan_candidates:loanIds.size,loaded_documents:records.length,loaded_chunks:records.reduce((n,r)=>n+chunks(r).length,0),pii_blocked:piiBlocked,source_unresolved:sourceUnresolved,external_model_calls:0,gate_adopted:false}));
} finally { await sql.end(); }
