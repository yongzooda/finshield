-- AUTH-005·AUTH-011·D-014·DB 13.3: 계정 작업 차단 → Case 정리 → Auth 마지막 삭제.
-- 0036 Guard를 유지한다. 완료 표시와 Auth Cascade는 한 트랜잭션이다.
create or replace function private.guard_account_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner uuid := (to_jsonb(new)->>'owner_id')::uuid;
begin
  if owner is null then owner := (to_jsonb(new)->>'id')::uuid; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||owner::text,0));
  if exists(select 1 from public.deletion_requests where owner_id=owner and target_type='ACCOUNT' and status <> 'COMPLETED') then
    raise exception 'ACCOUNT_DELETING' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function private.guard_account_work() from public,anon,authenticated,finshield_worker;
-- 정리 이벤트·Outbox·삭제 원장은 허용한다. 사용자 데이터 생성 경계만 차단한다.
do $$ declare item text; begin
  foreach item in array array['public.financial_cases','public.financial_profiles','public.financial_profile_versions',
    'public.case_inputs','public.case_input_pages','public.case_input_findings','public.claims','public.claim_revisions',
    'public.processing_consents','public.verification_runs','public.revalidation_jobs','public.precase_assessments',
    'private.input_objects','private.ocr_artifacts','private.case_embeddings'] loop
    execute format('create trigger trg_account_work_guard before insert on %s for each row execute function private.guard_account_work()',item);
  end loop;
end $$;
create trigger trg_account_work_guard before update on public.profiles for each row execute function private.guard_account_work();
create trigger trg_account_profile_update_guard before update on public.financial_profiles for each row execute function private.guard_account_work();

create or replace function private.request_account_deletion(p_owner uuid,p_hash text,p_hmac text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare req uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||p_owner::text,0));
  select id into req from public.deletion_requests where owner_id=p_owner and target_type='ACCOUNT' and idempotency_key='account-delete-v1';
  if found then return req; end if;
  if not exists(select 1 from public.profiles where id=p_owner) then raise exception 'ACCOUNT_NOT_FOUND' using errcode='42501'; end if;
  insert into public.deletion_requests(owner_id,target_type,target_id,status,idempotency_key,request_hash)
    values(p_owner,'ACCOUNT',p_owner,'ACCESS_BLOCKED','account-delete-v1',p_hash) returning id into req;
  insert into private.deletion_ledger(event_type,target_type,target_hmac,key_version,policy_version,deletion_request_id,backup_cutoff_at,retain_until,verification_hash)
    values('REQUESTED','ACCOUNT',p_hmac,'k1','deletion-policy-v1',req,now(),now()+interval '120 days',p_hash);
  update public.financial_cases set deleted_at=coalesce(deleted_at,now()),deletion_status='PENDING' where owner_id=p_owner and deletion_status='ACTIVE';
  update public.verification_runs set status='CANCELLED',finished_at=now(),started_at=coalesce(started_at,now()),reason_code='CASE_DELETED' where owner_id=p_owner and status in ('QUEUED','RUNNING');
  update public.revalidation_jobs set cancel_requested_at=coalesce(cancel_requested_at,now()) where owner_id=p_owner and status in ('QUEUED','RUNNING');
  return req;
end $$;

-- 회원 토큰 또는 서명된 삭제 영수증을 확인한 서버만 호출한다. 사용자 본문을 반환하지 않는다.
create or replace function private.account_deletion_status(p_owner uuid,p_request uuid)
returns jsonb language sql security definer set search_path = '' as $$
 select jsonb_build_object('id',id,'status',status,'completed_at',completed_at)
 from public.deletion_requests where target_type='ACCOUNT'
   and ((p_owner is not null and owner_id=p_owner) or (p_owner is null and id=p_request))
 order by requested_at desc limit 1
$$;

create or replace function private.account_cleanup_context(p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare req public.deletion_requests%rowtype; cid uuid; child uuid;
begin
  select * into req from public.deletion_requests where id=p_request and target_type='ACCOUNT' for update;
  if not found then raise exception 'ACCOUNT_REQUEST_NOT_FOUND' using errcode='42501'; end if;
  if req.status='COMPLETED' then return jsonb_build_object('status','COMPLETED'); end if;
  perform private.assert_can_see_storage_objects();
  select id into cid from public.financial_cases where owner_id=req.owner_id order by id limit 1;
  if cid is not null then
    select id into child from public.deletion_requests where owner_id=req.owner_id and target_type='CASE' and target_id=cid and status<>'COMPLETED' order by requested_at limit 1;
  end if;
  return jsonb_build_object('status',req.status,'owner_id',req.owner_id,'case_id',cid,'case_request_id',child,'orphan_paths',case when cid is null then
    (select coalesce(jsonb_agg(name),'[]'::jsonb) from (select name from storage.objects
      where bucket_id='finshield-quarantine' and name like req.owner_id::text||'/%' order by name limit 20) o)
    else '[]'::jsonb end);
end $$;

create or replace function private.finish_account_deletion(p_request uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare req public.deletion_requests%rowtype; led private.deletion_ledger%rowtype;
begin
  select * into req from public.deletion_requests where id=p_request and target_type='ACCOUNT' for update;
  if not found then raise exception 'ACCOUNT_REQUEST_NOT_FOUND' using errcode='42501'; end if;
  if req.status='COMPLETED' then return true; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account-delete:'||req.owner_id::text,0));
  perform private.assert_can_see_storage_objects();
  if exists(select 1 from public.financial_cases where owner_id=req.owner_id)
    or exists(select 1 from public.deletion_requests where owner_id=req.owner_id and id<>req.id and status<>'COMPLETED')
    or exists(select 1 from private.input_objects where owner_id=req.owner_id and deleted_at is null)
    or exists(select 1 from private.ocr_artifacts where owner_id=req.owner_id and deleted_at is null)
    or exists(select 1 from private.case_embeddings where owner_id=req.owner_id)
    or exists(select 1 from private.file_cleanup_jobs where owner_id=req.owner_id and status<>'SUCCEEDED')
    or exists(select 1 from storage.objects where bucket_id='finshield-quarantine' and name like req.owner_id::text||'/%') then return false; end if;
  select * into led from private.deletion_ledger where deletion_request_id=req.id and event_type='REQUESTED' and target_type='ACCOUNT';
  if not found then raise exception 'ACCOUNT_LEDGER_REQUIRED' using errcode='55000'; end if;
  -- 완료 상태는 아래 Auth 삭제가 성공해야만 commit된다. 실패 시 0036 Guard도 포함해 rollback된다.
  update public.deletion_requests set status='COMPLETED',completed_at=now(),error_code=null where id=req.id;
  delete from auth.users where id=req.owner_id;
  if exists(select 1 from auth.users where id=req.owner_id) or exists(select 1 from public.profiles where id=req.owner_id) then
    raise exception 'ACCOUNT_DELETE_UNCONFIRMED' using errcode='55000';
  end if;
  insert into private.deletion_ledger(event_type,target_type,target_hmac,key_version,policy_version,deletion_request_id,backup_cutoff_at,retain_until,deletion_verified_at,verification_hash)
    values('COMPLETED','ACCOUNT',led.target_hmac,led.key_version,led.policy_version,req.id,led.backup_cutoff_at,led.retain_until,now(),
      encode(extensions.digest('ACCOUNT:'||led.target_hmac||':COMPLETED:'||led.policy_version,'sha256'),'hex'));
  return true;
end $$;

revoke all on function private.request_account_deletion(uuid,text,text),private.account_deletion_status(uuid,uuid),private.account_cleanup_context(uuid),private.finish_account_deletion(uuid) from public,anon,authenticated;
grant execute on function private.request_account_deletion(uuid,text,text),private.account_deletion_status(uuid,uuid),private.account_cleanup_context(uuid),private.finish_account_deletion(uuid) to finshield_worker;

-- 탈퇴 접수 뒤 기존 JWT의 직접 DB·Storage 접근도 즉시 차단한다.
-- AUTH-001·SEC-AUTH-002/003: 로그아웃 뒤 남은 JWT의 직접 DB·Storage 접근 차단.
-- auth.sessions는 Supabase 관리형 표다. 업무 데이터·Refresh를 복제하지 않는다.
create or replace function public.member_session_active()
returns boolean
language plpgsql security definer stable set search_path = ''
as $$
declare
  claims jsonb;
  sid text;
  exp_text text;
begin
  claims := auth.jwt();
  sid := claims ->> 'session_id';
  exp_text := claims ->> 'exp';
  if sid is null or sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or exp_text is null or exp_text !~ '^[0-9]{1,12}$' then return false; end if;
  if exp_text::numeric <= extract(epoch from now()) then return false; end if;
  if exists(select 1 from public.deletion_requests where owner_id=auth.uid() and target_type='ACCOUNT' and status<>'COMPLETED') then return false; end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = sid::uuid and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  );
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.member_session_active() from public, anon, finshield_worker;
grant execute on function public.member_session_active() to authenticated;
comment on function public.member_session_active() is
  '호출 JWT의 Owner·session_id·만료와 Auth 세션 부재를 검사한다. 인자·세션 내용은 공개하지 않는다';


-- 실행 예약 응답이 불명확한 요청의 재전송 폭주를 막는다. 다음 예약도 같은 삭제 요청을 사용한다.
alter table public.deletion_requests add column dispatch_not_before timestamptz;
create or replace function private.claim_account_deletion_dispatch(p_request uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.deletion_requests set dispatch_not_before=now()+interval '5 minutes'
  where id=p_request and target_type='ACCOUNT' and status<>'COMPLETED'
    and (dispatch_not_before is null or dispatch_not_before<=now());
  return found;
end $$;
revoke all on function private.claim_account_deletion_dispatch(uuid) from public,anon,authenticated;
grant execute on function private.claim_account_deletion_dispatch(uuid) to finshield_worker;
