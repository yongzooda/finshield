-- AUTH-005·D-014·DB 13.3: Auth/Admin Cascade가 Case·임시물 정리를 건너뛰지 못하게 한다.
-- 계정 탈퇴 API를 활성화하는 Migration이 아니다. 정리 완료 뒤 Auth를 마지막에 지운다.
create or replace function private.guard_profile_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.financial_cases where owner_id = old.id)
     or exists (select 1 from private.input_objects where owner_id = old.id and deleted_at is null)
     or exists (select 1 from private.ocr_artifacts where owner_id = old.id and deleted_at is null)
     or exists (select 1 from private.case_embeddings where owner_id = old.id)
     or exists (select 1 from private.file_cleanup_jobs where owner_id = old.id and status <> 'SUCCEEDED')
     or exists (select 1 from public.deletion_requests where owner_id = old.id and status <> 'COMPLETED') then
    raise exception 'ACCOUNT_CLEANUP_REQUIRED' using errcode = '55000';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_profile_deletion() from public, anon, authenticated, finshield_worker;

drop trigger if exists trg_profiles__guard_delete on public.profiles;
create trigger trg_profiles__guard_delete
before delete on public.profiles
for each row execute function private.guard_profile_deletion();
comment on function private.guard_profile_deletion() is
  'DB 13.3: Case·임시 객체·미완료 삭제가 남으면 Profile 직접 삭제와 Auth Cascade를 거부한다';
