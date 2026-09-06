-- 0019 서버가 만드는 upload slot 불변식 (명세 4.3, 6.1, ADR 6.1)
\set ON_ERROR_STOP on
\echo '== 16. Upload slot 불변식'

begin;
set local role postgres;

create temp table sctx (key text primary key, val uuid) on commit drop;

do $$
declare owner uuid := gen_random_uuid(); prof uuid; ver uuid; kase uuid;
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
  values (owner, 'LOAN', 'slot 시험 Case', ver) returning id into kase;
  insert into sctx values ('owner', owner), ('case', kase);
end
$$;

\echo '1. 서버가 경로를 정하고 한 번만 확인된다'
do $$
declare owner uuid := (select val from sctx where key = 'owner');
        kase uuid := (select val from sctx where key = 'case');
        r record; o private.input_objects%rowtype;
begin
  select * into r from private.open_upload_slot(owner, kase, 'IMAGE', 'image/png', 1024, 1, 3600);
  if r.object_path <> owner::text || '/' || kase::text || '/' || r.case_input_id::text || '/' || r.object_id::text || '.png' then
    raise exception '경로 구성이 계약과 다릅니다: %', r.object_path;
  end if;
  if not exists (select 1 from private.input_objects where id = r.object_id and slot_state = 'OPEN') then
    raise exception 'slot 이 OPEN 으로 만들어지지 않았습니다';
  end if;
  if not public.storage_slot_is_open('finshield-quarantine', r.object_path) is not null then
    raise exception 'slot 판정 함수가 동작하지 않습니다';
  end if;
  select * into o from private.confirm_upload_slot(r.object_id, '89504e47');
  if o.slot_state <> 'UPLOADED' or o.uploaded_at is null then
    raise exception '확인 뒤 상태가 UPLOADED 가 아닙니다';
  end if;
  perform fstest.expect_fail(format($sql$select private.confirm_upload_slot(%L::uuid, '89504e47')$sql$, r.object_id),
    '이미 확인된 slot 의 재확인');
  raise notice '  허용 확인: 서버가 경로를 정하고 확인은 한 번만 성공한다';
end
$$;

\echo '2. 선언 MIME·크기·입력 유형을 거부한다'
do $$
declare owner uuid := (select val from sctx where key = 'owner');
        kase uuid := (select val from sctx where key = 'case');
begin
  perform fstest.expect_fail(format($sql$select private.open_upload_slot(%L::uuid, %L::uuid, 'IMAGE', 'text/html', 1024, 1, 3600)$sql$, owner, kase),
    '허용하지 않는 선언 MIME');
  perform fstest.expect_fail(format($sql$select private.open_upload_slot(%L::uuid, %L::uuid, 'IMAGE', 'image/png', 20971520, 1, 3600)$sql$, owner, kase),
    '10 MiB 초과');
  perform fstest.expect_fail(format($sql$select private.open_upload_slot(%L::uuid, %L::uuid, 'TEXT', 'image/png', 1024, 1, 3600)$sql$, owner, kase),
    'Text 입력의 slot');
  perform fstest.expect_fail(format($sql$select private.open_upload_slot(%L::uuid, %L::uuid, 'IMAGE', 'image/png', 1024, 1, 90000)$sql$, owner, kase),
    '24시간을 넘는 수명');
  perform fstest.expect_fail(format($sql$select private.open_upload_slot(%L::uuid, %L::uuid, 'IMAGE', 'image/png', 1024, 1, 3600)$sql$, gen_random_uuid(), kase),
    '다른 소유자의 Case');
  raise notice '  거부 확인: MIME·크기·유형·수명·소유자를 모두 막는다';
end
$$;

\echo '3. 닫힌 slot 은 더 이상 열린 경로가 아니다'
do $$
declare owner uuid := (select val from sctx where key = 'owner');
        kase uuid := (select val from sctx where key = 'case');
        r record; o private.input_objects%rowtype;
begin
  select * into r from private.open_upload_slot(owner, kase, 'PDF', 'application/pdf', 2048, 3, 3600);
  select * into o from private.close_upload_slot(r.object_id, 'USER_STOPPED');
  if o.slot_state <> 'CLOSED' or o.access_blocked_at is null then
    raise exception '닫은 뒤 상태가 CLOSED·차단이 아닙니다';
  end if;
  if exists (select 1 from public.case_inputs where id = r.case_input_id and input_outcome = 'ACTIVE') then
    raise exception '닫힌 slot 의 입력이 아직 ACTIVE 입니다';
  end if;
  perform fstest.expect_fail(format($sql$select private.confirm_upload_slot(%L::uuid, '25504446')$sql$, r.object_id),
    '닫힌 slot 의 업로드 확인');
  raise notice '  거부 확인: 닫힌 slot 은 확인도 안 되고 입력도 종결된다';
end
$$;

\echo '4. 확인된 slot 은 닫기가 아니라 Cleanup 으로 처리한다'
do $$
declare owner uuid := (select val from sctx where key = 'owner');
        kase uuid := (select val from sctx where key = 'case');
        r record;
begin
  select * into r from private.open_upload_slot(owner, kase, 'IMAGE', 'image/jpeg', 4096, 1, 3600);
  perform private.confirm_upload_slot(r.object_id, 'ffd8ff');
  perform fstest.expect_fail(format($sql$select private.close_upload_slot(%L::uuid, 'X')$sql$, r.object_id),
    '확인된 slot 의 닫기');
  raise notice '  거부 확인: 확인된 slot 은 닫기로 되돌리지 못한다';
end
$$;

\echo '5. 회원·익명은 이 함수를 부를 수 없다'
do $$
begin
  perform fstest.expect_fail($sql$
    set local role authenticated;
    select private.open_upload_slot(gen_random_uuid(), gen_random_uuid(), 'IMAGE', 'image/png', 1024, 1, 3600)
  $sql$, '회원의 직접 slot 생성');
  raise notice '  거부 확인: slot 생성은 서버 역할만 부른다';
end
$$;

rollback;
\echo '16. Upload slot 불변식 5건을 통과했습니다.'
