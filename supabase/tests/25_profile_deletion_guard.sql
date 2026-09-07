-- AUTH-005·D-014·DB 13.3: Auth가 먼저 삭제돼 미완료 정리의 소유 관계를 잃지 않는다.
\echo '계정 삭제 선행 정리 Guard'
begin;
create or replace function fstest.expect_cleanup_guard(statement text, label text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when sqlstate '55000' then
    if sqlerrm <> 'ACCOUNT_CLEANUP_REQUIRED' then raise; end if;
    raise notice '  거부 확인: %  (55000)', label;
    return;
  end;
  raise exception '계정 정리 Guard가 거부하지 않았습니다: %', label;
end;
$$;

do $$
declare
  account_id uuid := 'dc674cb6-49ad-4133-9999-ccc007000001';
  clean_id uuid := 'dc674cb6-49ad-4133-9999-ccc007000002';
  req uuid;
  state text;
  case_id uuid;
begin
  insert into auth.users(id) values (account_id),(clean_id);
  if not exists (select 1 from public.profiles where id=account_id) then
    raise exception '시험 Profile 생성 실패';
  end if;
  foreach state in array array['REQUESTED','ACCESS_BLOCKED','CLEANING','FAILED'] loop
    insert into public.deletion_requests(owner_id,target_type,target_id,status,idempotency_key,request_hash)
    values (account_id,'ACCOUNT',account_id,state,'account-guard-'||state,repeat('a',64)) returning id into req;
    perform fstest.expect_cleanup_guard(format('delete from public.profiles where id=%L',account_id),'미완료 '||state||' Profile 직접 삭제');
    perform fstest.expect_cleanup_guard(format('delete from auth.users where id=%L',account_id),'미완료 '||state||' Auth Cascade');
    if not exists (select 1 from auth.users where id=account_id)
       or not exists (select 1 from public.profiles where id=account_id)
       or not exists (select 1 from public.deletion_requests where id=req and status=state) then
      raise exception '거부 뒤 계정·Profile·삭제 요청이 소실됐다';
    end if;
    update public.deletion_requests set status='COMPLETED',completed_at=now() where id=req;
  end loop;
  insert into public.deletion_requests(owner_id,target_type,target_id,status,idempotency_key,request_hash)
  values (account_id,'CASE',gen_random_uuid(),'CLEANING','case-guard',repeat('b',64)) returning id into req;
  perform fstest.expect_cleanup_guard(format('delete from auth.users where id=%L',account_id),'미완료 Case 삭제 요청');
  update public.deletion_requests set status='COMPLETED',completed_at=now() where id=req;
  case_id := private.create_case(account_id,'LOAN','합성 계정 삭제 시험','account-guard-case',repeat('c',64));
  perform fstest.expect_cleanup_guard(format('delete from public.profiles where id=%L',account_id),'활성 Case의 Profile 직접 삭제');
  perform fstest.expect_cleanup_guard(format('delete from auth.users where id=%L',account_id),'활성 Case의 Auth Cascade');
  -- 이 Case는 파일·Run이 없는 격리 Fixture다. 운영 Case는 승인된 Purge를 사용한다.
  delete from public.financial_cases where id=case_id;
  delete from public.financial_profile_versions where owner_id=account_id;
  delete from public.financial_profiles where owner_id=account_id;
  perform fstest.expect_ok(format('delete from auth.users where id=%L',account_id),'완료 원장 보존 뒤 Auth 마지막 삭제');
  if exists(select 1 from public.profiles where id=account_id)
     or (select count(*) from public.deletion_requests where owner_id=account_id and status='COMPLETED')<>5 then
    raise exception '정상 삭제 뒤 Profile 잔존 또는 완료 요청 유실';
  end if;
  perform fstest.expect_ok(format('delete from auth.users where id=%L',clean_id),'소유 자산 없는 계정 삭제');
  if has_function_privilege('authenticated','private.guard_profile_deletion()','EXECUTE')
     or has_function_privilege('finshield_worker','private.guard_profile_deletion()','EXECUTE') then
    raise exception 'Guard 함수의 직접 실행 권한 누출';
  end if;
  raise notice '  통과: 거부 뒤 계정 보존·정상 최종 삭제·함수 권한';
end;
$$;
do $$ begin raise notice '25_profile_deletion_guard 시험을 모두 통과했습니다'; end $$;
rollback;
