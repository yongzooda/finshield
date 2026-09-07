-- AUTH-005·D-014: 실제 SQL 트랜잭션·Guard·멱등 종결. 모든 합성 행은 rollback한다.
begin;
create or replace function fstest.fail_auth_delete() returns trigger language plpgsql as $$
begin raise exception 'INJECTED_AUTH_DELETE_FAILURE' using errcode='22000'; end $$;
do $$
declare v_owner uuid := 'dc674cb6-49ad-4133-9999-ccc008000001'; other uuid := 'dc674cb6-49ad-4133-9999-ccc008000002';
  cid uuid; req uuid; child uuid; state jsonb;
begin
  insert into auth.users(id) values(v_owner),(other);
  cid := private.create_case(v_owner,'LOAN','합성 탈퇴 시험','account-case',repeat('a',64));
  req := private.request_account_deletion(v_owner,repeat('b',64),repeat('c',64));
  if req<>private.request_account_deletion(v_owner,repeat('b',64),repeat('c',64)) then raise exception '중복 요청'; end if;
  if not exists(select 1 from public.financial_cases where id=cid and deleted_at is not null) then raise exception '기존 Case 접근 미차단'; end if;
  begin
    perform private.create_case(v_owner,'LOAN','탈퇴 뒤 새 작업','account-race',repeat('d',64));
    raise exception '새 Case 생성 허용';
  exception when sqlstate '55000' then if sqlerrm<>'ACCOUNT_DELETING' then raise; end if; end;
  begin
    update public.financial_profiles set income_band='UNSPECIFIED' where owner_id=v_owner;
    raise exception '프로필 수정 허용';
  exception when sqlstate '55000' then if sqlerrm<>'ACCOUNT_DELETING' then raise; end if; end;
  perform private.create_case(other,'LOAN','다른 회원 정상 작업','account-other',repeat('e',64));
  if private.finish_account_deletion(req) then raise exception 'Case 잔존 조기 완료'; end if;
  child := private.request_case_deletion(v_owner,cid,'case-delete:'||cid::text,repeat('f',64),repeat('1',64),'k1','deletion-policy-v1');
  if not private.purge_case(child) then raise exception '파일 없는 Case 정리 실패'; end if;
  -- 관리형 Storage의 고아 객체도 부재 확인 전에는 완료하지 않는다.
  insert into storage.objects(bucket_id,name) values('finshield-quarantine',v_owner::text||'/orphan');
  if private.finish_account_deletion(req) then raise exception 'Storage 잔존 조기 완료'; end if;
  state := private.account_cleanup_context(req);
  if state->'orphan_paths' <> jsonb_build_array(v_owner::text||'/orphan') then raise exception '고아 객체 정리 범위 불일치'; end if;
  delete from storage.objects where name=v_owner::text||'/orphan';
  execute 'create trigger fstest_auth_failure before delete on auth.users for each row execute function fstest.fail_auth_delete()';
  begin
    perform private.finish_account_deletion(req);
    raise exception 'Auth 실패 주입 미동작';
  exception when sqlstate '22000' then if sqlerrm<>'INJECTED_AUTH_DELETE_FAILURE' then raise; end if; end;
  if not exists(select 1 from auth.users where id=v_owner) or not exists(select 1 from public.profiles where id=v_owner)
    or exists(select 1 from public.deletion_requests where id=req and status='COMPLETED')
    or exists(select 1 from private.deletion_ledger where deletion_request_id=req and event_type='COMPLETED') then
    raise exception 'Auth 실패 시 완료/계정 부분 commit';
  end if;
  execute 'drop trigger fstest_auth_failure on auth.users';
  if not private.finish_account_deletion(req) or not private.finish_account_deletion(req) then raise exception '정상·중복 종결 실패'; end if;
  if exists(select 1 from auth.users where id=v_owner) or exists(select 1 from public.profiles where id=v_owner)
    or exists(select 1 from public.financial_profiles where owner_id=v_owner)
    or exists(select 1 from public.financial_profile_versions where owner_id=v_owner) then raise exception '계정 자산 잔존'; end if;
  if (select count(*) from private.deletion_ledger where deletion_request_id=req)<>2 then raise exception '원장 중복/누락'; end if;
  state := private.account_deletion_status(null,req);
  if state->>'status'<>'COMPLETED' or private.account_deletion_status(other,req) is not null then raise exception '상태 복원/교차 회원 누출'; end if;
  if has_function_privilege('authenticated','private.finish_account_deletion(uuid)','EXECUTE')
    or has_function_privilege('anon','private.account_deletion_status(uuid,uuid)','EXECUTE') then raise exception '함수 권한 누출'; end if;
  raise notice '통과: 새 작업 차단·다른 회원 정상·Case/Storage 잔존 거부·Auth 실패 rollback·반복 완료·비식별 원장·교차 회원 거부';
end $$;
rollback;
