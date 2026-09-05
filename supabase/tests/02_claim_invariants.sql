-- ============================================================
-- 0005 제약·RLS 시험 (명세 6.3, 9.1)
--
-- 01_case_invariants.sql 이 만든 시험 데이터를 이어서 쓴다. 그 파일이
-- 마지막에 Case A 를 삭제 표시하므로 여기서 되돌린 뒤 시작한다.
-- ============================================================

update public.financial_cases
   set deletion_status = 'ACTIVE', deleted_at = null
 where id = '00000000-0000-4000-8000-0000000000ca';

\echo '7. claims'
insert into public.claims
  (id, owner_id, case_id, source_input_id, source_page_id, origin, claim_type,
   source_locator, extraction_method)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-0000000000f1', 'EXTRACTED', 'INTEREST_RATE',
        '{"schema_version":"1","page":1}'::jsonb, 'MODEL');

select fstest.expect_fail($sql$
  insert into public.claims
    (owner_id, case_id, origin, claim_type, source_locator, extraction_method)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 'DERIVED', 'INTEREST_RATE',
          '{"schema_version":"1"}'::jsonb, 'RULE')
$sql$, '부모 없는 DERIVED Claim');

select fstest.expect_fail($sql$
  insert into public.claims
    (owner_id, case_id, origin, claim_type, source_locator, extraction_method)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 'EXTRACTED', 'INTEREST_RATE',
          '{"schema_version":"1"}'::jsonb, 'MODEL')
$sql$, '원문 입력 없는 EXTRACTED Claim');

select fstest.expect_fail($sql$
  insert into public.claims
    (owner_id, case_id, source_page_id, origin, claim_type, source_locator,
     extraction_method)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000f1', 'USER_ADDED', 'INTEREST_RATE',
          '{"schema_version":"1"}'::jsonb, 'USER')
$sql$, '입력 없이 페이지만 지정한 Claim');

select fstest.expect_fail($sql$
  insert into public.claims
    (owner_id, case_id, origin, claim_type, source_locator, extraction_method)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca', 'USER_ADDED', 'INTEREST_RATE',
          '{"page":1}'::jsonb, 'USER')
$sql$, 'source_locator 에 schema_version 없음');

select fstest.expect_fail($sql$
  insert into public.claims
    (owner_id, case_id, parent_claim_id, origin, claim_type, source_locator,
     extraction_method)
  values ('00000000-0000-4000-8000-00000000000b',
          '00000000-0000-4000-8000-0000000000cb',
          '00000000-0000-4000-8000-0000000000c1', 'DERIVED', 'INTEREST_RATE',
          '{"schema_version":"1"}'::jsonb, 'RULE')
$sql$, '다른 Case 의 Claim 을 부모로 지정');

select fstest.expect_ok($sql$
  insert into public.claims
    (id, owner_id, case_id, parent_claim_id, origin, claim_type, source_locator,
     extraction_method)
  values ('00000000-0000-4000-8000-0000000000c2',
          '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 'DERIVED', 'EFFECTIVE_RATE',
          '{"schema_version":"1"}'::jsonb, 'RULE')
$sql$, '같은 Case 부모를 가진 파생 Claim');

\echo '8. claim_revisions'
insert into public.claim_revisions
  (id, owner_id, case_id, claim_id, revision_no, statement_masked,
   structured_value, materiality, edit_source, content_hash)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000c1',
        1, '연 15.9% 금리라고 안내받았다',
        '{"schema_version":"1","value":15.9,"unit":"PERCENT_PER_YEAR"}'::jsonb,
        'MATERIAL', 'EXTRACTION', repeat('c', 64));

select fstest.expect_fail($sql$
  update public.claim_revisions set user_confirmed = true
   where id = '00000000-0000-4000-8000-0000000000b1'
$sql$, 'Append-only revision UPDATE');

select fstest.expect_fail($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 1, '중복 순번',
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', 'USER_EDIT', repeat('d', 64))
$sql$, '같은 Claim 에 중복 revision_no');

select fstest.expect_fail($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 2, '파생 규칙 버전 없음',
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', 'SYSTEM_DERIVATION',
          repeat('d', 64))
$sql$, '규칙 버전 없는 SYSTEM_DERIVATION revision');

select fstest.expect_fail($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, edit_source, is_removed, content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 2, '삭제 표시 없는 제거',
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', 'USER_REMOVE', false,
          repeat('d', 64))
$sql$, 'USER_REMOVE 인데 is_removed 가 false');

select fstest.expect_fail($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, edit_source, is_removed, user_confirmed,
     content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 2, '삭제인데 확정',
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', 'USER_REMOVE', true, true,
          repeat('d', 64))
$sql$, '삭제 revision 을 사용자 확정으로 표시');

select fstest.expect_fail($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 2, repeat('가', 1400),
          '{"schema_version":"1"}'::jsonb, 'MATERIAL', 'USER_EDIT', repeat('d', 64))
$sql$, 'statement_masked 4KiB 초과');

select fstest.expect_fail($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 2, '구조값 Schema 없음',
          '{"value":1}'::jsonb, 'MATERIAL', 'USER_EDIT', repeat('d', 64))
$sql$, 'structured_value 에 schema_version 없음');

select fstest.expect_ok($sql$
  insert into public.claim_revisions
    (owner_id, case_id, claim_id, revision_no, statement_masked,
     structured_value, materiality, user_confirmed, edit_source, content_hash)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000c1', 2, '연 15.9% 금리를 확인했다',
          '{"schema_version":"1","value":15.9,"unit":"PERCENT_PER_YEAR"}'::jsonb,
          'MATERIAL', true, 'USER_EDIT', repeat('e', 64))
$sql$, '사용자 확정 revision 추가');

\echo '9. processing_consents'
insert into public.processing_consents
  (id, owner_id, case_id, case_input_id, consent_type, notice_version,
   provider_code, data_categories, decision)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a',
        '00000000-0000-4000-8000-0000000000ca', '00000000-0000-4000-8000-0000000000e1',
        'EXTERNAL_OCR_RAW_TRANSFER', 'v1', 'CLOVA_OCR',
        array['DOCUMENT_IMAGE'], 'DENIED');

select fstest.expect_fail($sql$
  update public.processing_consents set decision = 'GRANTED'
   where id = '00000000-0000-4000-8000-0000000000a1'
$sql$, '동의 증적 UPDATE');

select fstest.expect_fail($sql$
  delete from public.processing_consents
   where id = '00000000-0000-4000-8000-0000000000a1'
$sql$, '거절 증적 삭제');

select fstest.expect_fail($sql$
  insert into public.processing_consents
    (owner_id, case_id, case_input_id, consent_type, notice_version,
     provider_code, data_categories, decision)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'TERMS_OF_SERVICE', 'v1',
          'CLOVA_OCR', array['DOCUMENT_IMAGE'], 'GRANTED')
$sql$, '일반 약관 동의를 처리 동의로 대체');

select fstest.expect_fail($sql$
  insert into public.processing_consents
    (owner_id, case_id, case_input_id, consent_type, notice_version,
     provider_code, data_categories, decision)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'EXTERNAL_OCR_RAW_TRANSFER',
          'v1', 'CLOVA_OCR', array[]::text[], 'GRANTED')
$sql$, '전송 범주가 빈 배열인 동의');

select fstest.expect_fail($sql$
  insert into public.processing_consents
    (owner_id, case_id, case_input_id, consent_type, notice_version,
     provider_code, data_categories, decision)
  values ('00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'EXTERNAL_OCR_RAW_TRANSFER',
          'v1', 'CLOVA_OCR', array['DOCUMENT_IMAGE'], 'REVOKED')
$sql$, '대상 없는 철회');

select fstest.expect_ok($sql$
  insert into public.processing_consents
    (id, owner_id, case_id, case_input_id, consent_type, notice_version,
     provider_code, data_categories, decision, supersedes_consent_id)
  values ('00000000-0000-4000-8000-0000000000a2',
          '00000000-0000-4000-8000-00000000000a',
          '00000000-0000-4000-8000-0000000000ca',
          '00000000-0000-4000-8000-0000000000e1', 'EXTERNAL_OCR_RAW_TRANSFER',
          'v1', 'CLOVA_OCR', array['DOCUMENT_IMAGE'], 'GRANTED',
          '00000000-0000-4000-8000-0000000000a1')
$sql$, '앞선 결정을 대체하는 새 동의');

select fstest.expect_fail($sql$
  update public.case_inputs
     set external_ocr_consent_id = '00000000-0000-4000-8000-0000000000a2'
   where id = '00000000-0000-4000-8000-0000000000e2'
$sql$, '다른 입력의 동의를 참조 (0004 FK 보강 확인)');

select fstest.expect_ok($sql$
  update public.case_inputs
     set external_ocr_consent_id = '00000000-0000-4000-8000-0000000000a2'
   where id = '00000000-0000-4000-8000-0000000000e1'
$sql$, '같은 입력에 대해 기록된 동의 참조');

-- ------------------------------------------------------------
-- 10. RLS
-- ------------------------------------------------------------
\echo '10. RLS 교차 소유'
do $$
declare own_claims int; other_claims int; own_revs int; own_consents int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  select count(*) into own_claims from public.claims;
  select count(*) into own_revs from public.claim_revisions;
  select count(*) into own_consents from public.processing_consents;
  if own_claims <> 2 then raise exception '본인 Claim 조회 실패 (%)', own_claims; end if;
  if own_revs <> 2 then raise exception '본인 revision 조회 실패 (%)', own_revs; end if;
  if own_consents <> 2 then raise exception '본인 동의 조회 실패 (%)', own_consents; end if;
  raise notice '  허용 확인: 본인 Claim·revision·동의 조회';

  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b"}';
  select count(*) into other_claims from public.claims;
  if other_claims <> 0 then raise exception '타인 Claim 이 보입니다 (%)', other_claims; end if;
  raise notice '  허용 확인: 타인 Claim 차단';
end
$$;

do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a"}';
  perform fstest.expect_fail($sql$
    insert into public.claims
      (owner_id, case_id, origin, claim_type, source_locator, extraction_method)
    values ('00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-0000000000ca', 'USER_ADDED', 'X',
            '{"schema_version":"1"}'::jsonb, 'USER')
  $sql$, '회원이 Claim 을 직접 INSERT');
  perform fstest.expect_fail($sql$
    insert into public.processing_consents
      (owner_id, case_id, case_input_id, consent_type, notice_version,
       provider_code, data_categories, decision)
    values ('00000000-0000-4000-8000-00000000000a',
            '00000000-0000-4000-8000-0000000000ca',
            '00000000-0000-4000-8000-0000000000e1', 'EXTERNAL_OCR_RAW_TRANSFER',
            'v1', 'CLOVA_OCR', array['DOCUMENT_IMAGE'], 'GRANTED')
  $sql$, '회원이 동의를 직접 INSERT');
end
$$;

do $$
begin
  set local role anon;
  perform fstest.expect_fail($sql$ select count(*) from public.claims $sql$,
    '익명이 claims 조회');
  perform fstest.expect_fail($sql$ select count(*) from public.claim_revisions $sql$,
    '익명이 claim_revisions 조회');
  perform fstest.expect_fail($sql$ select count(*) from public.processing_consents $sql$,
    '익명이 processing_consents 조회');
end
$$;

-- ------------------------------------------------------------
-- 11. Cascade 는 여전히 동작해야 한다 (명세 5.3)
--     직접 DELETE 차단이 Case·계정 삭제까지 막으면 안 된다.
-- ------------------------------------------------------------
\echo '11. Cascade 삭제'
select fstest.expect_fail($sql$
  delete from public.case_events
   where id = '00000000-0000-4000-8000-0000000000f2'
$sql$, 'Case 가 살아 있는데 Event 직접 삭제');

select fstest.expect_fail($sql$
  delete from public.claim_revisions
   where id = '00000000-0000-4000-8000-0000000000b1'
$sql$, 'Claim 이 살아 있는데 revision 직접 삭제');

do $$
declare remaining int;
begin
  delete from public.financial_cases
   where id = '00000000-0000-4000-8000-0000000000ca';
  select (select count(*) from public.case_events)
       + (select count(*) from public.case_inputs)
       + (select count(*) from public.claims)
       + (select count(*) from public.claim_revisions)
       + (select count(*) from public.processing_consents)
       + (select count(*) from private.input_objects)
       + (select count(*) from private.ocr_artifacts)
    into remaining;
  if remaining <> 0 then
    raise exception 'Case Cascade 뒤 자식 행이 남았습니다 (%)', remaining;
  end if;
  raise notice '  허용 확인: Case 삭제 Cascade 로 모든 자식 제거';
end
$$;

\echo '0005 불변식 시험을 통과했습니다.'
