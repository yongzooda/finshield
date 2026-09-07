-- B-DEMO-01: 공개 Demo용 공식 자료 Release와 실행 Manifest의 불변 연결.
begin;

do $$
declare
  release_id uuid;
  manifest_id uuid;
  old_agent_count int;
  new_agent_count int;
  old_tool_count int;
  new_tool_count int;
begin
  select id into release_id from kb.kb_releases where version='p0-judge-demo-corpus-v1';
  if release_id is null then raise exception 'Demo KB Release 없음'; end if;
  if (select document_count from kb.kb_releases where id=release_id)<>2
     or (select chunk_count from kb.kb_releases where id=release_id)<>2
     or (select count(*) from kb.knowledge_documents where kb_release_id=release_id)<>2
     or (select count(*) from kb.knowledge_chunks where kb_release_id=release_id)<>2 then
    raise exception 'Release 선언과 실제 문서·Chunk 수 불일치';
  end if;
  if exists(select 1 from kb.knowledge_embeddings where kb_release_id=release_id) then
    raise exception 'Embedding 미채택 Release에 Embedding 존재';
  end if;
  if (select count(distinct source_snapshot_id) from kb.kb_release_sources where kb_release_id=release_id)<>2 then
    raise exception 'Release 공식 출처 고정 실패';
  end if;
  if not exists(
    select 1 from kb.knowledge_documents d join kb.knowledge_chunks c on c.knowledge_document_id=d.id
     where d.kb_release_id=release_id and d.document_type='PRODUCT'
       and c.chunk_text like '%대출금리 15.9%%' and c.chunk_text like '%대출한도 2000만원%'
       and d.content_hash=c.content_hash
  ) then raise exception '상품 기준 본문 또는 Hash 연결 실패'; end if;
  if not exists(
    select 1 from kb.knowledge_documents d join kb.knowledge_chunks c on c.knowledge_document_id=d.id
     where d.kb_release_id=release_id and d.document_type='GUIDE'
       and c.chunk_text like '%사칭한 SNS 채널%' and c.chunk_text like '%문자 메시지 발송%'
       and d.content_hash=c.content_hash
  ) then raise exception '사칭 안내 본문 또는 Hash 연결 실패'; end if;
  if not exists(
    select 1 from kb.source_fetch_events e join kb.source_snapshots s on s.id=e.source_snapshot_id
     where s.official_id='data.go.kr:15094787:햇살론15:202602:1'
       and e.request_key like '%2026-09-07T19:39:47.125Z'
       and e.outcome='UNCHANGED' and e.fresh_until>e.retrieved_at
  ) then raise exception '동일 상품 재조회 사건 누락'; end if;

  select id into manifest_id from private.execution_manifests where manifest_version='finshield-p0-loan-v4';
  if manifest_id is null or (select kb_release_id from private.execution_manifests where id=manifest_id)<>release_id then
    raise exception 'v4 Manifest와 Demo KB Release 연결 실패';
  end if;
  select count(*) into old_agent_count from private.execution_manifest_agents a
   join private.execution_manifests m on m.id=a.execution_manifest_id where m.manifest_version='finshield-p0-loan-v3';
  select count(*) into new_agent_count from private.execution_manifest_agents where execution_manifest_id=manifest_id;
  select count(*) into old_tool_count from private.execution_manifest_tools t
   join private.execution_manifests m on m.id=t.execution_manifest_id where m.manifest_version='finshield-p0-loan-v3';
  select count(*) into new_tool_count from private.execution_manifest_tools where execution_manifest_id=manifest_id;
  if new_agent_count<>old_agent_count or new_tool_count<>old_tool_count then
    raise exception 'Manifest Agent·Tool 연결 복제 실패: agents %/%, tools %/%',new_agent_count,old_agent_count,new_tool_count,old_tool_count;
  end if;
  raise notice '통과: 공식 상품·사칭 안내 본문 2건, 재조회 사건, v4 Manifest 연결';
end $$;

do $$ begin raise notice '34_demo_evidence_connection 시험을 모두 통과했습니다'; end $$;
rollback;
