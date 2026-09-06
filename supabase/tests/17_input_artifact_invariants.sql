-- 0020 입력 산출물 등록·중단 경로 불변식 (명세 6.2, 6.4, ADR 15.1)
\set ON_ERROR_STOP on
\echo '== 17. 입력 산출물·중단 불변식'

begin;
set local role postgres;

create temp table actx (key text primary key, val uuid) on commit drop;

do $$
declare owner uuid := gen_random_uuid(); prof uuid; ver uuid; kase uuid; r record;
begin
  insert into auth.users (id) values (owner);
  insert into public.financial_profiles
    (owner_id, schema_version, income_band, debt_burden_band, emergency_fund_band,
     purpose_code, horizon_code, liquidity_need, loss_tolerance, completeness)
  values (owner, 'v1', 'BAND_2', 'LOW', 'BAND_1', 'LOAN_REFINANCE', 'SHORT', 'MEDIUM', 'LOW', 'COMPLETE')
  returning id into prof;
  insert into public.financial_profile_versions
    (owner_id, profile_id, version_no, schema_version, snapshot, completeness, content_hash, created_reason)
  values (owner, prof, 1, 'v1', '{"schema_version":"v1"}'::jsonb, 'COMPLETE', repeat('a', 64), 'CASE_CREATED')
  returning id into ver;
  insert into public.financial_cases (owner_id, scenario, title_masked, initial_profile_version_id)
  values (owner, 'LOAN', '산출물 시험 Case', ver) returning id into kase;
  select * into r from private.open_upload_slot(owner, kase, 'IMAGE', 'image/png', 1024, 1, 3600);
  insert into actx values ('owner', owner), ('case', kase), ('input', r.case_input_id), ('object', r.object_id);
end
$$;

\echo '1. 페이지는 함수로만 만들고 두 번 등록하지 못한다'
do $$
declare owner uuid := (select val from actx where key = 'owner');
        kase uuid := (select val from actx where key = 'case');
        inp uuid := (select val from actx where key = 'input');
        page uuid; n integer;
begin
  select pgid into page from private.register_input_pages(owner, kase, inp, 2) as pgid limit 1;
  select count(*) into n from public.case_input_pages where case_input_id = inp;
  if n <> 2 then raise exception '페이지가 두 장 만들어지지 않았습니다: %', n; end if;
  if page is null then raise exception '페이지 식별자를 돌려주지 않았습니다'; end if;
  begin
    perform private.register_input_pages(owner, kase, inp, 1);
    raise exception '이미 등록된 입력에 페이지를 다시 넣었습니다';
  exception when unique_violation then null;
  end;
  begin
    perform private.register_input_pages(owner, kase, inp, 11);
    raise exception '페이지 상한을 넘겼는데 통과했습니다';
  exception when check_violation then null;
  end;
  insert into actx values ('page', (select id from public.case_input_pages where case_input_id = inp and page_no = 1));
end
$$;

\echo '2. 소유자·Case 가 다르면 산출물을 등록하지 못한다'
do $$
declare owner uuid := (select val from actx where key = 'owner');
        kase uuid := (select val from actx where key = 'case');
        inp uuid := (select val from actx where key = 'input');
        page uuid := (select val from actx where key = 'page');
begin
  begin
    perform private.register_ocr_artifact(gen_random_uuid(), kase, inp, page, 'SPIKE', 'x/y.png', 3600);
    raise exception '남의 소유자로 OCR 임시물을 등록했습니다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.register_ocr_artifact(owner, kase, inp, page, 'SPIKE', 'x/y.png', 86401);
    raise exception '24시간을 넘는 수명이 통과했습니다';
  exception when check_violation then null;
  end;
  begin
    perform private.register_case_embedding(owner, kase, gen_random_uuid(), page,
      'spike', 'v1', array_fill(0::real, array[1024])::extensions.vector, repeat('b', 64), 3600);
    raise exception '없는 입력에 vector 를 등록했습니다';
  exception when insufficient_privilege then null;
  end;
end
$$;

\echo '3. Claim 확인은 원본·임시물·vector 를 모두 청소에 넣는다'
do $$
declare owner uuid := (select val from actx where key = 'owner');
        kase uuid := (select val from actx where key = 'case');
        inp uuid := (select val from actx where key = 'input');
        page uuid := (select val from actx where key = 'page');
        obj uuid := (select val from actx where key = 'object');
        art uuid; emb uuid; cl uuid; n integer;
begin
  select private.register_ocr_artifact(owner, kase, inp, page, 'SPIKE', 'ocr/a.png', 3600) into art;
  select private.register_case_embedding(owner, kase, inp, page, 'spike', 'v1',
    array_fill(0::real, array[1024])::extensions.vector, repeat('c', 64), 3600) into emb;

  perform private.confirm_upload_slot(obj, '89504e47');
  perform private.advance_input_stage(owner, kase, inp, 'VALIDATED',
    jsonb_build_object('detected_mime', 'image/png', 'magic_signature', '89504e47'));
  perform private.advance_input_stage(owner, kase, inp, 'EXTRACTED');
  perform private.advance_input_stage(owner, kase, inp, 'MASKED',
    jsonb_build_object('masked_text', '마스킹 본문', 'masked_text_hash', repeat('d', 64),
                       'pii_policy_version', 'v1'));

  select private.record_extracted_claim(owner, kase, inp, page, 'PRODUCT_TERM', '확인할 Claim') into cl;
  if (select user_confirmed from public.claim_revisions where claim_id = cl and revision_no = 1) then
    raise exception '추출 직후 Revision 이 이미 확정으로 기록됐습니다';
  end if;
  if private.confirm_claim(owner, kase, cl) <> 2 then
    raise exception '확정이 새 Revision 을 쌓지 않았습니다';
  end if;
  if private.confirm_claim(owner, kase, cl) <> 2 then
    raise exception '확정이 멱등하지 않습니다';
  end if;

  perform private.advance_input_stage(owner, kase, inp, 'CLAIM_CONFIRMED');

  select count(*) into n from private.file_cleanup_jobs
   where case_input_id = inp and reason_code = 'CLAIM_CONFIRMED';
  if n <> 3 then
    raise exception 'Claim 확인이 세 대상을 청소에 넣지 않았습니다: %', n;
  end if;
  if not exists (select 1 from private.file_cleanup_jobs
                  where target_id = emb and target_type = 'CASE_EMBEDDING'
                    and reason_code = 'CLAIM_CONFIRMED') then
    raise exception 'Case vector 가 청소에 들어가지 않았습니다';
  end if;
  if art is null then raise exception 'OCR 임시물 식별자가 없습니다'; end if;
end
$$;

\echo '4. 사용자 중단은 결과 축만 바꾸고 세 대상을 청소에 넣는다'
do $$
declare owner uuid := (select val from actx where key = 'owner');
        kase uuid := (select val from actx where key = 'case');
        r record; inp uuid; page uuid; n integer; i public.case_inputs%rowtype;
begin
  select * into r from private.open_upload_slot(owner, kase, 'IMAGE', 'image/png', 1024, 1, 3600);
  inp := r.case_input_id;
  select pgid into page from private.register_input_pages(owner, kase, inp, 1) as pgid limit 1;
  perform private.register_ocr_artifact(owner, kase, inp, page, 'SPIKE', 'ocr/b.png', 3600);
  perform private.register_case_embedding(owner, kase, inp, page, 'spike', 'v1',
    array_fill(0::real, array[1024])::extensions.vector, repeat('e', 64), 3600);

  select private.stop_case_input(owner, kase, inp, 'USER_STOPPED') into n;
  if n <> 3 then raise exception '중단이 세 대상을 청소에 넣지 않았습니다: %', n; end if;

  select * into i from public.case_inputs where id = inp;
  if i.input_outcome <> 'CANCELLED' then raise exception '결과 축이 CANCELLED 가 아닙니다'; end if;
  if i.input_stage <> 'QUARANTINED' then raise exception '처리 단계가 보존되지 않았습니다: %', i.input_stage; end if;

  -- 두 번 불러도 새 작업을 만들지 않는다.
  select private.stop_case_input(owner, kase, inp, 'USER_STOPPED') into n;
  if n <> 0 then raise exception '중단이 멱등하지 않습니다: %', n; end if;
end
$$;

\echo '5. 산출물 등록 함수는 worker 만 실행한다'
do $$
declare r record; n integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'private'
       and p.proname in ('register_input_pages', 'register_ocr_artifact',
                         'register_case_embedding', 'stop_case_input',
                         'record_extracted_claim', 'confirm_claim')
  loop
    if has_function_privilege('anon', r.sig, 'EXECUTE')
       or has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      raise exception '% 를 클라이언트 역할이 실행할 수 있습니다', r.sig;
    end if;
    if not has_function_privilege('finshield_worker', r.sig, 'EXECUTE') then
      raise exception '% 를 worker 가 실행할 수 없습니다', r.sig;
    end if;
    n := n + 1;
  end loop;
  if n <> 6 then raise exception '등록 함수가 여섯 개가 아닙니다: %', n; end if;
end
$$;

rollback;
\echo '== 17 통과'
