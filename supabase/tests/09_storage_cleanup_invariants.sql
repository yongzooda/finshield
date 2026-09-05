-- ============================================================
-- 0013 Storage·Cleanup·Outbox·삭제 시험 (명세 10, 12, 13, 6.9)
--
-- 08 이 Case cf 를 지웠다. 여기서는 Case c9 를 새로 만들어 업로드 slot →
-- 접근 차단 → 부재 확인 → 삭제 요청 → Purge 까지 한 바퀴 돈다.
-- ============================================================

\echo '43. 준비: Case·입력·페이지'
insert into public.financial_cases (id, owner_id, scenario, title_masked, initial_profile_version_id)
values ('00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-00000000000a', 'LOAN', 'Storage 시험 Case',
        '00000000-0000-4000-8000-0000000000d1');
insert into public.case_inputs
  (id, owner_id, case_id, input_type, input_stage, raw_delete_status, pii_scan_status, raw_expires_at, size_bytes, page_count)
values ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c9', 'PDF', 'QUARANTINED', 'PENDING', 'PENDING',
        now() + interval '23 hours', 2048, 2);
insert into public.case_input_pages
  (id, owner_id, case_id, case_input_id, page_no, parse_status, locator_schema_version)
values ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000e9', 1, 'SUCCEEDED', 'v1');

\echo '44. Bucket 과 upload slot'
do $$
declare n int;
begin
  select count(*) into n from storage.buckets where id in ('finshield-quarantine', 'finshield-kb') and public = false;
  if n <> 2 then raise exception 'Private Bucket 두 개가 없습니다 (%)', n; end if;
  if exists (select 1 from storage.buckets where id = 'finshield-exports') then
    raise exception 'P0 에 exports Bucket 이 있습니다';
  end if;
  raise notice '  허용 확인: Private Bucket 두 개, exports 없음';
end
$$;

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension, encryption_state, expires_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
          '00000000-0000-4000-8000-0000000000e9', 'PDF', 'finshield-quarantine',
          '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/other-input/11111111-1111-4111-8111-111111111111.pdf',
          'pdf', 'VERIFIED', now() + interval '1 hour')
$sql$, 'owner/case/input 구성이 아닌 object_path');

select fstest.expect_fail($sql$
  insert into private.input_objects
    (owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension, encryption_state, expires_at, slot_state)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
          '00000000-0000-4000-8000-0000000000e9', 'PDF', 'finshield-quarantine',
          '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/22222222-2222-4222-8222-222222222222.pdf',
          'pdf', 'VERIFIED', now() + interval '1 hour', 'UPLOADED')
$sql$, 'uploaded_at 없는 UPLOADED slot');

insert into private.input_objects
  (id, owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension, encryption_state, expires_at)
values ('00000000-0000-4000-8000-000000000e91', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000e9', 'PDF', 'finshield-quarantine',
        '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/11111111-1111-4111-8111-111111111111.pdf',
        'pdf', 'VERIFIED', now() + interval '1 hour');

\echo '45. storage.objects 정책: 본인의 열린 slot 에만 INSERT'
do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$
    insert into storage.objects (bucket_id, name)
    values ('finshield-quarantine', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/99999999-9999-4999-8999-999999999999.pdf')
  $sql$, 'slot 이 없는 경로에 업로드');
  perform fstest.expect_fail($sql$
    insert into storage.objects (bucket_id, name)
    values ('finshield-kb', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/11111111-1111-4111-8111-111111111111.pdf')
  $sql$, '격리 Bucket 이 아닌 곳에 업로드');
  insert into storage.objects (bucket_id, name)
  values ('finshield-quarantine', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/11111111-1111-4111-8111-111111111111.pdf');
  raise notice '  허용 확인: 본인의 열린 slot 경로에 업로드';
  select count(*) into n from storage.objects;
  if n <> 0 then raise exception '회원이 storage.objects 를 읽었습니다 (%)', n; end if;
  update storage.objects set metadata = '{}'::jsonb where bucket_id = 'finshield-quarantine';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '회원이 storage.objects 를 수정했습니다 (%)', n; end if;
  delete from storage.objects where bucket_id = 'finshield-quarantine';
  get diagnostics n = row_count;
  if n <> 0 then raise exception '회원이 storage.objects 를 지웠습니다 (%)', n; end if;
  raise notice '  허용 확인: 회원의 storage.objects SELECT·UPDATE·DELETE 는 0건';
end
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b"}';
  perform fstest.expect_fail($sql$
    insert into storage.objects (bucket_id, name)
    values ('finshield-quarantine', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/11111111-1111-4111-8111-111111111111.pdf')
  $sql$, '타인의 slot 경로에 업로드');
end
$$;

do $$
begin
  set local role anon;
  perform fstest.expect_fail($sql$ select public.storage_slot_is_open('finshield-quarantine', 'x') $sql$,
    '익명이 slot 판정 함수 호출');
end
$$;

-- 서버가 객체를 검증하고 slot 을 닫는다. 그 뒤에는 같은 경로 재업로드가 거부된다.
update private.input_objects set slot_state = 'UPLOADED', uploaded_at = now()
 where id = '00000000-0000-4000-8000-000000000e91';
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$
    insert into storage.objects (bucket_id, name)
    values ('finshield-quarantine', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/11111111-1111-4111-8111-111111111111.pdf')
  $sql$, '닫힌 slot 경로에 재업로드');
end
$$;

\echo '46. Signed URL 발급 전 확인'
do $$
declare r record;
begin
  select * into r from private.authorize_input_object_read('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000e91');
  if r.ttl_seconds <> 60 or r.bucket_id <> 'finshield-quarantine' then raise exception '발급 조건이 다릅니다'; end if;
  raise notice '  허용 확인: 본인·미차단·미만료·업로드 확인 객체에 60초 Signed URL 허가';
end
$$;
select fstest.expect_fail($sql$
  select * from private.authorize_input_object_read('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000e91')
$sql$, '타인 객체 Signed URL');

\echo '47. Cleanup enqueue → claim → 부재 확인 → finish'
do $$
declare v_job uuid; v_again uuid; n int; blocked timestamptz;
begin
  v_job := private.enqueue_file_cleanup('INPUT_OBJECT', '00000000-0000-4000-8000-000000000e91', 'CLAIM_CONFIRMED');
  v_again := private.enqueue_file_cleanup('INPUT_OBJECT', '00000000-0000-4000-8000-000000000e91', 'CLAIM_CONFIRMED');
  if v_job <> v_again then raise exception '같은 대상·이유가 Job 을 두 번 만들었습니다'; end if;
  select access_blocked_at into blocked from private.input_objects where id = '00000000-0000-4000-8000-000000000e91';
  if blocked is null then raise exception 'enqueue 가 접근을 차단하지 않았습니다'; end if;
  select count(*) into n from private.outbox_events where deduplication_key = 'raw-delete:' || v_job::text;
  if n <> 1 then raise exception 'RAW_DELETE_REQUESTED Outbox 가 없습니다'; end if;
  if (select raw_delete_requested_at from public.case_inputs where id = '00000000-0000-4000-8000-0000000000e9') is null then
    raise exception '입력의 raw_delete_requested_at 이 비어 있습니다';
  end if;
  raise notice '  허용 확인: enqueue 는 접근 차단·Job·Outbox 를 한 Transaction 에 남긴다';
end
$$;
select fstest.expect_fail($sql$
  select * from private.authorize_input_object_read('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000e91')
$sql$, '접근 차단 뒤 Signed URL');

do $$
declare j private.file_cleanup_jobs%rowtype; n int;
begin
  set local role finshield_worker;
  select * into j from private.claim_file_cleanup_jobs(10, 60);
  if j.id is null or j.status <> 'RUNNING' or j.lease_token is null or j.attempt_no <> 1 then
    raise exception 'Worker 가 Job 을 Claim 하지 못했습니다';
  end if;
  select count(*) into n from private.claim_file_cleanup_jobs(10, 60);
  if n <> 0 then raise exception 'Lease 중인 Job 이 다시 Claim 됐습니다'; end if;
  raise notice '  허용 확인: Worker Claim 은 Lease·Attempt 를 부여하고 중복 Claim 을 막는다';
  perform fstest.expect_fail(format($sql$ select private.finish_file_cleanup_job(%L, gen_random_uuid()) $sql$, j.id),
    '다른 Lease token 으로 finish');
  perform fstest.expect_fail(format($sql$ select private.finish_file_cleanup_job(%L, %L) $sql$, j.id, j.lease_token),
    'Storage 객체가 남아 있는데 삭제 성공 기록');
end
$$;
do $$
declare n int;
begin
  if (select raw_delete_status from public.case_inputs where id = '00000000-0000-4000-8000-0000000000e9') <> 'RUNNING' then
    raise exception 'Claim 뒤 입력의 raw_delete_status 가 RUNNING 이 아닙니다';
  end if;
  -- Storage 에서 객체가 실제로 사라진 뒤에만 성공을 기록한다.
  delete from storage.objects where bucket_id = 'finshield-quarantine'
    and name like '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/%';
  perform private.finish_file_cleanup_job(j.id, j.lease_token)
    from private.file_cleanup_jobs j where j.target_id = '00000000-0000-4000-8000-000000000e91';
  if (select status from private.file_cleanup_jobs where target_id = '00000000-0000-4000-8000-000000000e91') <> 'SUCCEEDED' then
    raise exception 'Job 이 SUCCEEDED 가 아닙니다';
  end if;
  if (select deleted_at from private.input_objects where id = '00000000-0000-4000-8000-000000000e91') is null then
    raise exception '객체 메타데이터의 deleted_at 이 비어 있습니다';
  end if;
  select count(*) into n from public.case_inputs
   where id = '00000000-0000-4000-8000-0000000000e9' and raw_delete_status = 'SUCCEEDED' and raw_deleted_at is not null;
  if n <> 1 then raise exception '입력의 원본 삭제 축이 종결되지 않았습니다'; end if;
  raise notice '  허용 확인: 부재 확인 뒤 Job·객체·입력 삭제 축 종결';
end
$$;

\echo '48. Cleanup 실패·재시도·소진 경보'
insert into private.ocr_artifacts
  (id, owner_id, case_id, case_input_id, page_id, status, expires_at)
values ('00000000-0000-4000-8000-000000000a91', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000e9',
        '00000000-0000-4000-8000-0000000000f9', 'AVAILABLE', now() + interval '1 hour');
do $$
declare v_job uuid; j private.file_cleanup_jobs%rowtype; n int;
begin
  v_job := private.enqueue_file_cleanup('OCR_ARTIFACT', '00000000-0000-4000-8000-000000000a91', 'TTL_EXPIRED');
  if (select status from private.ocr_artifacts where id = '00000000-0000-4000-8000-000000000a91') <> 'DELETE_REQUESTED' then
    raise exception 'OCR 중간물이 DELETE_REQUESTED 가 아닙니다';
  end if;
  update private.file_cleanup_jobs set max_attempts = 2 where id = v_job;
  select * into j from private.claim_file_cleanup_jobs(10, 60);
  perform private.finish_file_cleanup_job(j.id, j.lease_token, 'STORAGE_5XX');
  select * into j from private.file_cleanup_jobs where id = v_job;
  if j.status <> 'FAILED' or j.available_at <= now() or j.lease_token is not null or j.finished_at is not null then
    raise exception '첫 실패가 Backoff 재시도 상태가 아닙니다';
  end if;
  select count(*) into n from private.claim_file_cleanup_jobs(10, 60);
  if n <> 0 then raise exception 'Backoff 중인 Job 이 Claim 됐습니다'; end if;
  update private.file_cleanup_jobs set available_at = now() where id = v_job;
  select * into j from private.claim_file_cleanup_jobs(10, 60);
  perform private.finish_file_cleanup_job(j.id, j.lease_token, 'STORAGE_5XX');
  select * into j from private.file_cleanup_jobs where id = v_job;
  if j.status <> 'FAILED' or j.finished_at is null or j.attempt_no <> 2 then
    raise exception '소진된 Job 이 종결되지 않았습니다';
  end if;
  select count(*) into n from private.outbox_events where deduplication_key = 'raw-delete-exhausted:' || v_job::text;
  if n <> 1 then raise exception '소진 경보 Outbox 가 없습니다'; end if;
  if (select access_blocked_at from private.ocr_artifacts where id = '00000000-0000-4000-8000-000000000a91') is null then
    raise exception '실패 뒤에도 접근 차단이 유지돼야 합니다';
  end if;
  raise notice '  허용 확인: 제한 Retry 뒤 소진 경보, 접근 차단 유지';
end
$$;

\echo '49. TTL·고아 Sweeper'
-- 만료된 객체 메타데이터, 메타데이터 없는 고아 객체, 객체 없는 UPLOADED 메타데이터
insert into private.input_objects
  (id, owner_id, case_id, case_input_id, input_type, bucket_id, object_path, safe_extension, encryption_state,
   created_at, expires_at, slot_state, uploaded_at)
values ('00000000-0000-4000-8000-000000000e92', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000e9', 'PDF', 'finshield-quarantine',
        '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/33333333-3333-4333-8333-333333333333.pdf',
        'pdf', 'VERIFIED', now() - interval '25 hours', now() - interval '1 hour', 'UPLOADED', now() - interval '24 hours'),
       ('00000000-0000-4000-8000-000000000e93', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000e9', 'PDF', 'finshield-quarantine',
        '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/44444444-4444-4444-8444-444444444444.pdf',
        'pdf', 'VERIFIED', now(), now() + interval '1 hour', 'UPLOADED', now());
insert into storage.objects (bucket_id, name)
values ('finshield-quarantine', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/33333333-3333-4333-8333-333333333333.pdf'),
       ('finshield-quarantine', '00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-0000000000c9/00000000-0000-4000-8000-0000000000e9/55555555-5555-4555-8555-555555555555.pdf');
do $$
declare r record; n int;
begin
  select coalesce(jsonb_object_agg(kind, affected), '{}'::jsonb) as m into r from private.sweep_expired_raw_objects();
  if (r.m ->> 'INPUT_OBJECT_TTL')::int <> 1 or (r.m ->> 'ORPHAN_OBJECT')::int <> 1 or (r.m ->> 'OBJECT_MISSING')::int <> 1 then
    raise exception 'Sweeper 집계가 다릅니다: %', r.m;
  end if;
  select count(*) into n from private.outbox_events where event_type = 'ORPHAN_OBJECT_DETECTED';
  if n <> 1 then raise exception '고아 객체 경보가 없습니다'; end if;
  select count(*) into n from private.file_cleanup_jobs where reason_code in ('TTL_EXPIRED', 'OBJECT_MISSING') and target_type = 'INPUT_OBJECT';
  if n <> 2 then raise exception 'Sweeper 가 Cleanup 을 만들지 않았습니다 (%)', n; end if;
  raise notice '  허용 확인: Sweeper 가 만료·고아·객체 없음 을 모두 찾는다';
end
$$;

\echo '50. case_embeddings'
select fstest.expect_fail($sql$
  insert into private.case_embeddings
    (owner_id, case_id, case_input_id, page_id, model_id, model_version, dimensions, embedding, masked_content_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
          '00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000f9', 'embed-v4.0', '2026-09', 1024,
          array_fill(0.01, array[1024])::extensions.vector, repeat('a', 64), now() + interval '25 hours')
$sql$, 'Embedding 24시간 초과');
select fstest.expect_fail($sql$
  insert into private.case_embeddings
    (owner_id, case_id, case_input_id, page_id, model_id, model_version, dimensions, embedding, masked_content_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
          '00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000f9', 'embed-v4.0', '2026-09', 1024,
          array_fill(0.01, array[512])::extensions.vector, repeat('a', 64), now() + interval '1 hour')
$sql$, '1024 차원이 아닌 Embedding');
insert into private.case_embeddings
  (id, owner_id, case_id, case_input_id, page_id, model_id, model_version, dimensions, embedding, masked_content_hash, expires_at)
values ('00000000-0000-4000-8000-000000000b91', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
        '00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000f9', 'embed-v4.0', '2026-09', 1024,
        array_fill(0.01, array[1024])::extensions.vector, repeat('a', 64), now() + interval '1 hour');

\echo '51. Case 삭제 요청 → Cleanup 완료 → Purge'
do $$
declare v_req uuid; v_same uuid; n int;
begin
  v_req := private.request_case_deletion('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
             'del-1', repeat('c', 64), repeat('d', 64), 'k1', 'p1');
  v_same := private.request_case_deletion('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
             'del-1', repeat('c', 64), repeat('d', 64), 'k1', 'p1');
  if v_req <> v_same then raise exception '같은 Key·Hash 가 새 요청을 만들었습니다'; end if;
  if (select deletion_status from public.financial_cases where id = '00000000-0000-4000-8000-0000000000c9') <> 'PENDING' then
    raise exception 'Case 가 PENDING 이 아닙니다';
  end if;
  if (select status from public.deletion_requests where id = v_req) <> 'ACCESS_BLOCKED' then
    raise exception '요청이 ACCESS_BLOCKED 가 아닙니다';
  end if;
  select count(*) into n from public.case_events
   where case_id = '00000000-0000-4000-8000-0000000000c9' and event_type = 'CASE_DELETION_REQUESTED';
  if n <> 1 then raise exception '삭제 요청 Event 가 없습니다'; end if;
  select count(*) into n from private.deletion_ledger where deletion_request_id = v_req and event_type = 'REQUESTED';
  if n <> 1 then raise exception 'REQUESTED Ledger 가 없습니다'; end if;
  -- 남은 객체(e93 UPLOADED), OCR(a91 미삭제), Embedding(b91) 에 CASE_DELETED Cleanup 이 생긴다.
  select count(*) into n from private.file_cleanup_jobs where reason_code = 'CASE_DELETED';
  if n <> 4 then raise exception 'CASE_DELETED Cleanup 수가 다릅니다 (%)', n; end if;
  if private.purge_case(v_req) then raise exception 'Cleanup 이 남았는데 Purge 됐습니다'; end if;
  if (select status from public.deletion_requests where id = v_req) <> 'CLEANING' then
    raise exception 'Purge 보류 뒤 상태가 CLEANING 이 아닙니다';
  end if;
  raise notice '  허용 확인: 삭제 요청은 접근 차단·Event·Ledger·Cleanup 을 남기고 Purge 는 부재 확인 전 보류';
end
$$;
select fstest.expect_fail($sql$
  select private.request_case_deletion('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c9',
           'del-1', repeat('e', 64), repeat('d', 64), 'k1', 'p1')
$sql$, '같은 Key 다른 Payload 삭제 요청');
select fstest.expect_fail($sql$
  select private.request_case_deletion('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000c9',
           'del-2', repeat('c', 64), repeat('d', 64), 'k1', 'p1')
$sql$, '타인이 Case 삭제 요청');
select fstest.expect_fail($sql$
  update private.deletion_ledger set policy_version = 'p2'
$sql$, 'Ledger UPDATE');
select fstest.expect_fail($sql$
  delete from private.deletion_ledger
$sql$, 'Ledger DELETE');

do $$
declare n int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  select count(*) into n from public.deletion_requests;
  if n <> 1 then raise exception '회원이 본인 삭제 요청을 읽지 못했습니다 (%)', n; end if;
  perform fstest.expect_fail($sql$
    select private.enqueue_file_cleanup('INPUT_OBJECT', '00000000-0000-4000-8000-000000000e93', 'USER_STOPPED')
  $sql$, '회원이 Cleanup 함수 호출');
  raise notice '  허용 확인: 회원은 본인 삭제 요청만 읽고 Cleanup 함수는 못 부른다';
end
$$;

-- Worker 가 Cleanup 을 모두 끝낸다. 남은 Storage 객체를 먼저 지운다.
delete from storage.objects where bucket_id = 'finshield-quarantine';
do $$
declare j record; v_req uuid; n int;
begin
  for j in select * from private.claim_file_cleanup_jobs(50, 60) loop
    perform private.finish_file_cleanup_job(j.id, j.lease_token);
  end loop;
  select count(*) into n from private.file_cleanup_jobs
   where case_id = '00000000-0000-4000-8000-0000000000c9' and status in ('QUEUED', 'RUNNING');
  if n <> 0 then raise exception 'Cleanup 이 남았습니다 (%)', n; end if;
  select id into v_req from public.deletion_requests where target_id = '00000000-0000-4000-8000-0000000000c9';
  if not private.purge_case(v_req) then raise exception 'Purge 가 보류됐습니다'; end if;
  if exists (select 1 from public.financial_cases where id = '00000000-0000-4000-8000-0000000000c9') then
    raise exception 'Case 가 남았습니다';
  end if;
  if (select status from public.deletion_requests where id = v_req) <> 'COMPLETED' then
    raise exception '요청이 COMPLETED 가 아닙니다';
  end if;
  select count(*) into n from private.deletion_ledger where deletion_request_id = v_req and event_type = 'COMPLETED' and deletion_verified_at is not null;
  if n <> 1 then raise exception 'COMPLETED Ledger 가 없습니다'; end if;
  select (select count(*) from private.input_objects where case_id = '00000000-0000-4000-8000-0000000000c9')
       + (select count(*) from private.case_embeddings) + (select count(*) from private.file_cleanup_jobs)
    into n;
  if n <> 0 then raise exception 'Purge 뒤 잔여 행 (%)', n; end if;
  raise notice '  허용 확인: 부재 확인 뒤 Purge, 요청 COMPLETED, 비식별 Ledger 두 사건';
end
$$;

\echo '52. Idempotency·Outbox·Retention'
do $$
declare r record; r2 record;
begin
  select * into r from private.claim_idempotency('00000000-0000-4000-8000-00000000000a', null, 'CREATE_CASE', 'k-1', repeat('1', 64));
  if not r.is_new or r.status <> 'PROCESSING' then raise exception '첫 claim 이 새 기록이 아닙니다'; end if;
  select * into r2 from private.claim_idempotency('00000000-0000-4000-8000-00000000000a', null, 'CREATE_CASE', 'k-1', repeat('1', 64));
  if r2.is_new or r2.record_id <> r.record_id then raise exception '두 번째 claim 이 기존 기록을 돌려주지 않습니다'; end if;
  perform fstest.expect_fail($sql$
    select * from private.claim_idempotency('00000000-0000-4000-8000-00000000000a', null, 'CREATE_CASE', 'k-1', repeat('2', 64))
  $sql$, '같은 Key 다른 Hash');
  if not private.complete_idempotency(r.record_id, 'SUCCEEDED', 'financial_case', gen_random_uuid(), repeat('3', 64)) then
    raise exception '종결 기록 실패';
  end if;
  if private.complete_idempotency(r.record_id, 'FAILED') then raise exception '종결된 기록을 다시 종결했습니다'; end if;
  raise notice '  허용 확인: Idempotency claim·중복·충돌·종결';
end
$$;

do $$
declare e record; n int;
begin
  select count(*) into n from private.claim_outbox_events(100);
  if n < 1 then raise exception 'Outbox 를 Claim 하지 못했습니다'; end if;
  select * into e from private.outbox_events where status = 'PROCESSING' limit 1;
  perform private.finish_outbox_event(e.id);
  if (select status from private.outbox_events where id = e.id) <> 'DELIVERED' then raise exception 'DELIVERED 가 아닙니다'; end if;
  perform fstest.expect_fail(format($sql$ select private.finish_outbox_event(%L) $sql$, e.id), 'DELIVERED 를 다시 finish');
  select * into e from private.outbox_events where status = 'PROCESSING' limit 1;
  perform private.finish_outbox_event(e.id, 'DISPATCH_TIMEOUT');
  if (select status from private.outbox_events where id = e.id) <> 'FAILED'
     or (select available_at from private.outbox_events where id = e.id) <= now() then
    raise exception '실패 Outbox 가 Backoff 상태가 아닙니다';
  end if;
  update private.outbox_events set delivered_at = now() - interval '31 days' where status = 'DELIVERED';
  select coalesce(jsonb_object_agg(kind, affected), '{}'::jsonb) as m into e from private.sweep_operational_retention();
  if (e.m ->> 'OUTBOX_DELIVERED_30D')::int <> 1 then raise exception 'Retention 이 30일 지난 Outbox 를 지우지 않았습니다: %', e.m; end if;
  raise notice '  허용 확인: Outbox claim·전달·실패 Backoff·30일 Retention';
end
$$;

do $$
declare n int;
begin
  set local role finshield_worker;
  select count(*) into n from private.storage_preflight() where not is_public;
  if n <> 2 then raise exception 'Worker Preflight 가 Private Bucket 두 개를 보지 못했습니다 (%)', n; end if;
  select count(*) into n from private.claim_outbox_events(10);
  select count(*) into n from private.sweep_operational_retention();
  perform fstest.expect_fail($sql$ select count(*) from private.input_objects $sql$, 'Worker 가 input_objects 직접 조회');
  perform fstest.expect_fail($sql$ insert into private.outbox_events (aggregate_type, aggregate_id, event_type, deduplication_key, payload)
    values ('X_TYPE', gen_random_uuid(), 'X_EVENT', 'x', '{"schema_version":"1"}'::jsonb) $sql$, 'Worker 가 Outbox 직접 INSERT');
  raise notice '  허용 확인: Worker 는 함수로만 쓰고 표 직접 쓰기는 거부된다';
end
$$;

\echo '0013 불변식 시험을 통과했습니다.'
