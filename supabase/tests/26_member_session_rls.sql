-- AUTH-001·SEC-AUTH-002/003: 유효한 JWT 형태라도 폐기·만료·Owner 불일치면 직접 접근을 거부한다.
begin;
create policy session_fixture_allow on public.profiles for select to authenticated using (true);
do $$
declare
  owner_a uuid := '00000000-0000-4000-8000-00000000000a';
  first_sid uuid := '10000000-0000-4000-8000-00000000000a';
  second_sid uuid := '20000000-0000-4000-8000-00000000000a';
  active jsonb;
  bad jsonb;
  samples jsonb[];
  run_case uuid;
  passport uuid;
  guide uuid;
  file_case uuid;
  object_path text;
  changed integer;
  denied boolean;
begin
  active := jsonb_build_object('sub',owner_a,'session_id',first_sid,'exp',4102444800);
  perform set_config('request.jwt.claims',active::text,true);
  insert into auth.sessions(id,user_id) values(second_sid,owner_a);
  select c.id into run_case from public.financial_cases c
    where c.owner_id=owner_a and c.deleted_at is null and public.case_runs_json(c.id)<>'[]'::jsonb limit 1;
  select p.id into passport from public.evidence_passports p
    where p.owner_id=owner_a and public.passport_claims_json(p.id)<>'[]'::jsonb limit 1;
  select g.id into guide from public.action_guides g
    where g.owner_id=owner_a and public.guide_channels_json(g.id)<>'[]'::jsonb limit 1;
  if run_case is null or passport is null or guide is null then raise exception '정상 RPC 비교 자료가 없다'; end if;
  select private.create_case(owner_a,'LOAN','세션 경계 Storage 시험','session-rls-fixture',repeat('a',64)) into file_case;
  select s.object_path into object_path from private.open_upload_slot(owner_a,file_case,'IMAGE','image/png',100,1,3600) s;

  set local role authenticated;
  if not public.member_session_active() or (select count(*) from public.profiles where id=owner_a)<>1 then raise exception '정상 세션 읽기 거부'; end if;
  if not public.storage_slot_is_open('finshield-quarantine',object_path) then raise exception '정상 세션 slot 거부'; end if;
  if public.case_runs_json(run_case)='[]'::jsonb or public.passport_claims_json(passport)='[]'::jsonb or public.guide_channels_json(guide)='[]'::jsonb then raise exception '정상 RPC 거부'; end if;
  if not exists(select 1 from public.run_progress_v where case_id=run_case) then raise exception '정상 진행 View 거부'; end if;
  raise notice '  허용 확인: 정상 세션의 본인 조회·RPC 세 곳·Storage slot';
  reset role;

  delete from auth.sessions where id=first_sid;
  samples := array[
    active,
    active - 'session_id',
    active || '{"session_id":"잘못된 UUID"}'::jsonb,
    active || '{"session_id":"10000000-0000-4000-8000-00000000000b"}'::jsonb,
    active || jsonb_build_object('session_id',second_sid,'exp',1),
    active || jsonb_build_object('session_id',second_sid,'exp','잘못된 만료'),
    (active || jsonb_build_object('session_id',second_sid)) - 'exp'
  ];
  foreach bad in array samples loop
    perform set_config('request.jwt.claims',bad::text,true);
    set local role authenticated;
    if public.member_session_active() then raise exception '무효 세션이 활성 판정'; end if;
    if (select count(*) from public.profiles)<>0 or (select count(*) from public.financial_profiles)<>0 then raise exception '폐기 세션의 회원 표 누출'; end if;
    if public.case_runs_json(run_case)<>'[]'::jsonb or public.passport_claims_json(passport)<>'[]'::jsonb or public.guide_channels_json(guide)<>'[]'::jsonb then raise exception '폐기 세션의 RPC 누출'; end if;
    if exists(select 1 from public.run_progress_v) then raise exception '폐기 세션의 진행 View 누출'; end if;
    if public.storage_slot_is_open('finshield-quarantine',object_path) then raise exception '폐기 세션의 slot 노출'; end if;
    update public.financial_profiles set completeness=completeness where owner_id=owner_a;
    get diagnostics changed = row_count;
    if changed<>0 then raise exception '폐기 세션의 직접 UPDATE 허용'; end if;
    denied := false;
    begin
      insert into storage.objects(bucket_id,name) values('finshield-quarantine',object_path);
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception '폐기 세션의 Storage INSERT 허용'; end if;
    raise notice '  거부 확인: 무효 세션의 표·UPDATE·RPC 세 곳·slot·Storage 쓰기';
    reset role;
  end loop;

  perform set_config('request.jwt.claims',(active || jsonb_build_object('session_id',second_sid))::text,true);
  set local role authenticated;
  if not public.member_session_active() or (select count(*) from public.profiles where id=owner_a)<>1 then raise exception '다른 세션까지 폐기'; end if;
  insert into storage.objects(bucket_id,name) values('finshield-quarantine',object_path);
  raise notice '  허용 확인: 다른 세션의 회원 조회와 같은 정상 경로 Storage 쓰기';
  reset role;
  update auth.sessions set not_after=now()-interval '1 second' where id=second_sid;
  set local role authenticated;
  if public.member_session_active() then raise exception 'Auth 만료 시각 지난 세션 허용'; end if;
  raise notice '  거부 확인: Auth not_after 만료';
  reset role;

  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not exists(
      select 1 from pg_policy p where p.polrelid=c.oid and p.polname='member_session_required' and not p.polpermissive
        and p.polcmd='*' and (select oid from pg_roles where rolname='authenticated')=any(p.polroles)
        and pg_get_expr(p.polqual,p.polrelid) like '%member_session_active%'
        and pg_get_expr(p.polwithcheck,p.polrelid) like '%member_session_active%')) then raise exception '회원 표의 강제 세션 정책 누락'; end if;
  if has_function_privilege('anon','public.member_session_active()','EXECUTE') or has_function_privilege('finshield_worker','public.member_session_active()','EXECUTE') then raise exception '세션 helper 권한 확대'; end if;
  if has_schema_privilege('authenticated','private','USAGE') or has_table_privilege('authenticated','auth.sessions','SELECT') then raise exception '회원의 내부 세션 표 직접 접근 허용'; end if;
  raise notice '  통과: 전체 public 표의 Restrictive 정책·실행 권한·내부 표 비노출';
end;
$$;
rollback;
\echo '26_member_session_rls 시험을 모두 통과했습니다'
