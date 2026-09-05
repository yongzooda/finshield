-- ============================================================
-- 0005 Claim·수정 이력·처리 동의 (명세 6.3)
--
-- 대상: public.claims, public.claim_revisions,
--       public.processing_consents
--
-- 명세 6.3 의 `verification_run_claims` 는 여기 없다. 그 표는
-- `verification_runs` 를 참조하는데 아직 존재하지 않는다. 명세 15 의
-- Migration 묶음도 Run pinning 을 7번 묶음에 두므로, Run 테이블을
-- 만드는 Migration 에서 함께 추가한다. FK 없는 컬럼을 먼저 만들지
-- 않는다.
--
-- 0004 가 FK 없이 남긴 case_inputs.external_ocr_consent_id 는 여기서
-- 참조 대상이 생기므로 이번에 복합 FK 를 붙인다.
--
-- 권한은 명세 9.2 를 따른다. Claim Draft 도 회원에게 SELECT 만 준다.
-- 추출·수정·확정은 검증 RPC 가 담당한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. public.claims (명세 6.3)
--
--    Claim identity 는 여러 Run 에 걸쳐 유지된다. 내용은 여기 두지
--    않고 claim_revisions 가 Append-only 로 보관한다.
-- ------------------------------------------------------------
create table if not exists public.claims (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null,
  case_id           uuid not null,
  source_input_id   uuid,
  source_page_id    uuid,
  parent_claim_id   uuid,
  origin            text not null,
  claim_type        text not null,
  source_locator    jsonb not null,
  extraction_method text not null,
  created_at        timestamptz not null default now(),

  constraint fk_claims__financial_cases
    foreign key (case_id, owner_id)
    references public.financial_cases (id, owner_id) on delete cascade,
  constraint fk_claims__case_inputs
    foreign key (source_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,
  constraint fk_claims__case_input_pages
    foreign key (source_page_id, owner_id, case_id, source_input_id)
    references public.case_input_pages (id, owner_id, case_id, case_input_id)
    on delete cascade,
  -- 부모 Claim 은 같은 Owner·Case 안에서만 지정한다 (명세 7.1).
  constraint fk_claims__parent
    foreign key (parent_claim_id, owner_id, case_id)
    references public.claims (id, owner_id, case_id) on delete cascade,

  constraint uq_claims__id_owner_id unique (id, owner_id),
  constraint uq_claims__id_owner_case unique (id, owner_id, case_id),

  constraint ck_claims__origin
    check (origin in ('EXTRACTED', 'USER_ADDED', 'DERIVED')),
  constraint ck_claims__extraction_method
    check (extraction_method in ('MODEL', 'RULE', 'USER')),
  constraint ck_claims__claim_type_len
    check (octet_length(claim_type) between 1 and 64),
  constraint ck_claims__source_locator_object
    check (jsonb_typeof(source_locator) = 'object'),
  constraint ck_claims__source_locator_schema_version
    check (source_locator ? 'schema_version'),
  -- 파생 Claim 은 부모가 필수다. 근거 없이 새 사실을 만들지 못하게
  -- 하는 첫 단계다 (명세 6.3, 규칙 1).
  constraint ck_claims__derived_requires_parent
    check (origin <> 'DERIVED' or parent_claim_id is not null),
  constraint ck_claims__no_self_parent
    check (parent_claim_id is null or parent_claim_id <> id),
  -- 페이지 위치를 지정하면 어느 입력의 페이지인지도 있어야 한다.
  constraint ck_claims__page_requires_input
    check (source_page_id is null or source_input_id is not null),
  -- 추출 Claim 은 원문 위치가 있어야 한다. 사용자가 직접 추가한
  -- Claim 만 입력 없이 존재할 수 있다.
  constraint ck_claims__extracted_requires_input
    check (origin <> 'EXTRACTED' or source_input_id is not null)
);

comment on table public.claims is
  'Claim identity. 내용 버전은 claim_revisions 가 Append-only 로 보관한다 (명세 6.3)';
comment on column public.claims.source_locator is
  '페이지·영역·문단 위치만 저장한다. 원문을 넣지 않는다';

create index if not exists idx_claims__case_id_created_at
  on public.claims (case_id, created_at);

-- ------------------------------------------------------------
-- 2. public.claim_revisions (명세 6.3)
--
--    Append-only 다. 삭제도 새 revision 으로 기록한다.
--    unique (id, claim_id, case_id, owner_id) 는 Run 이 Claim identity 와
--    revision 을 서로 바꿔 끼우지 못하게 한다 (명세 5.1).
-- ------------------------------------------------------------
create table if not exists public.claim_revisions (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null,
  case_id                 uuid not null,
  claim_id                uuid not null,
  revision_no             integer not null,
  statement_masked        text not null,
  structured_value        jsonb not null,
  materiality             text not null,
  user_confirmed          boolean not null default false,
  is_removed              boolean not null default false,
  edit_source             text not null,
  derivation_rule_version text,
  content_hash            text not null,
  created_at              timestamptz not null default now(),

  constraint fk_claim_revisions__claims
    foreign key (claim_id, owner_id, case_id)
    references public.claims (id, owner_id, case_id) on delete cascade,

  constraint uq_claim_revisions__claim_revision_no unique (claim_id, revision_no),
  constraint uq_claim_revisions__id_owner_id unique (id, owner_id),
  constraint uq_claim_revisions__id_claim_case_owner
    unique (id, claim_id, case_id, owner_id),

  constraint ck_claim_revisions__revision_no check (revision_no > 0),
  constraint ck_claim_revisions__statement_masked_len
    check (octet_length(statement_masked) between 1 and 4096),
  constraint ck_claim_revisions__structured_value_object
    check (jsonb_typeof(structured_value) = 'object'),
  -- 숫자·단위·부정·조건·기간을 어떤 Schema 로 담았는지 남긴다.
  constraint ck_claim_revisions__structured_value_schema_version
    check (structured_value ? 'schema_version'),
  constraint ck_claim_revisions__materiality
    check (materiality in ('MATERIAL', 'NON_MATERIAL', 'UNDETERMINED')),
  constraint ck_claim_revisions__edit_source
    check (edit_source in ('EXTRACTION', 'USER_EDIT', 'USER_REMOVE',
                           'SYSTEM_DERIVATION')),
  -- 파생 revision 은 어떤 규칙 버전으로 만들었는지 남겨야 한다.
  constraint ck_claim_revisions__derivation_rule_version
    check (edit_source <> 'SYSTEM_DERIVATION'
           or derivation_rule_version is not null),
  constraint ck_claim_revisions__removal_marks_removed
    check (edit_source <> 'USER_REMOVE' or is_removed),
  -- 삭제 revision 을 사용자 확정으로 표시하지 않는다.
  constraint ck_claim_revisions__removed_not_confirmed
    check (not (is_removed and user_confirmed)),
  constraint ck_claim_revisions__content_hash
    check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.claim_revisions is
  'Append-only Claim 내용 버전. 삭제도 새 revision 으로 기록한다 (명세 6.3)';
comment on column public.claim_revisions.structured_value is
  '숫자·단위·부정·조건·기간 범위를 보존한다. 날짜가 불완전하면 precision 과 범위를 남기고 임의의 일을 만들지 않는다';

create index if not exists idx_claim_revisions__claim_id_revision_no
  on public.claim_revisions (claim_id, revision_no desc);

-- ------------------------------------------------------------
-- 3. public.processing_consents (명세 6.3)
--
--    거절·철회 행도 지우지 않는다. 원본 외부 전송은 같은 입력의 가장
--    최신 유효 동의가 GRANTED 일 때만 가능하다. 그 판정은 서버 함수가
--    하고, 여기서는 증적의 불변성과 형식을 강제한다.
-- ------------------------------------------------------------
create table if not exists public.processing_consents (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null,
  case_id               uuid not null,
  case_input_id         uuid not null,
  consent_type          text not null,
  notice_version        text not null,
  provider_code         text not null,
  data_categories       text[] not null,
  decision              text not null,
  supersedes_consent_id uuid,
  created_at            timestamptz not null default now(),

  constraint fk_processing_consents__case_inputs
    foreign key (case_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,
  constraint fk_processing_consents__supersedes
    foreign key (supersedes_consent_id, owner_id, case_id)
    references public.processing_consents (id, owner_id, case_id)
    on delete cascade,

  constraint uq_processing_consents__id_owner_case
    unique (id, owner_id, case_id),
  -- case_input_id 까지 포함한 키를 둔다. case_inputs 가 이 키를 참조해
  -- "그 입력에 대해 기록된 동의" 만 가리키게 만든다.
  constraint uq_processing_consents__id_owner_case_input
    unique (id, owner_id, case_id, case_input_id),

  -- P0 는 원본 외부 전송 동의 하나만 쓴다. 일반 약관 동의를 이 동의로
  -- 대체할 수 없다 (명세 6.3, SEC-PRI-010).
  constraint ck_processing_consents__consent_type
    check (consent_type = 'EXTERNAL_OCR_RAW_TRANSFER'),
  constraint ck_processing_consents__decision
    check (decision in ('GRANTED', 'DENIED', 'REVOKED')),
  constraint ck_processing_consents__notice_version_len
    check (octet_length(notice_version) between 1 and 64),
  constraint ck_processing_consents__provider_code_len
    check (octet_length(provider_code) between 1 and 64),
  -- 무엇을 보내는지 비운 채로 동의를 받지 않는다.
  -- array_length 는 빈 배열에서 0 이 아니라 null 을 돌려주고 CHECK 는
  -- null 을 통과시킨다. cardinality 를 쓴다.
  constraint ck_processing_consents__data_categories
    check (cardinality(data_categories) >= 1
           and array_position(data_categories, null) is null),
  constraint ck_processing_consents__no_self_supersede
    check (supersedes_consent_id is null or supersedes_consent_id <> id),
  -- 철회는 반드시 앞선 동의를 가리킨다.
  constraint ck_processing_consents__revoke_requires_target
    check (decision <> 'REVOKED' or supersedes_consent_id is not null)
);

comment on table public.processing_consents is
  '원본 외부 전송 동의 증적. 거절·철회 행도 삭제하지 않는다 (명세 6.3)';
comment on column public.processing_consents.data_categories is
  '전송 범주. 빈 배열과 null 원소를 허용하지 않는다';

create index if not exists idx_processing_consents__input_created_at
  on public.processing_consents (case_input_id, created_at desc);

-- ------------------------------------------------------------
-- 4. 0004 가 남긴 FK 를 채운다 (명세 6.2, SEC-PRI-010)
--
--    case_inputs.external_ocr_consent_id 는 참조 대상이 없어 FK 없이
--    두었다. Owner·Case 까지만 묶으면 A 입력에 대해 받은 동의를 B 입력에
--    붙일 수 있다. 그러면 B 원본의 외부 전송이 A 의 동의로 정당화된다.
--
--    참조 키에 case_input_id 를 넣고 자식 쪽에서 자기 id 를 함께 보내
--    "이 입력에 대해 기록된 동의" 만 가리키게 한다.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'fk_case_inputs__processing_consents') then
    alter table public.case_inputs
      add constraint fk_case_inputs__processing_consents
      foreign key (external_ocr_consent_id, owner_id, case_id, id)
      references public.processing_consents (id, owner_id, case_id, case_input_id);
  end if;
end
$$;

-- ------------------------------------------------------------
-- 5. Trigger (명세 7.1)
--    claim_revisions 와 processing_consents 는 Append-only 다.
--    0003 의 private.reject_update() 를 재사용한다.
-- ------------------------------------------------------------
drop trigger if exists trg_claim_revisions__reject_update on public.claim_revisions;
create trigger trg_claim_revisions__reject_update
  before update on public.claim_revisions
  for each row execute function private.reject_update();

drop trigger if exists trg_processing_consents__reject_update on public.processing_consents;
create trigger trg_processing_consents__reject_update
  before update on public.processing_consents
  for each row execute function private.reject_update();

-- ------------------------------------------------------------
-- 5.1 직접 DELETE 차단 (명세 6.2, 6.3, 5.3)
--
--    reject_update 는 UPDATE 만 막는다. 명세는 Case Event 의 UPDATE 와
--    DELETE 를 "Case 전체 삭제 외 허용하지 않는다" 고 하고, 동의 증적도
--    "거절·철회 행도 삭제하지 않는다" 고 한다. 0004 는 UPDATE 만 막아
--    직접 DELETE 가 열려 있었다. 여기서 Forward-fix 한다.
--
--    Cascade 삭제는 허용해야 한다 (명세 5.3). Cascade 는 부모 행을 먼저
--    지우고 자식 Trigger 를 실행하므로, 부모가 아직 있으면 직접 삭제이고
--    부모가 없으면 Cascade 다. 이 차이로 구분한다.
--
--    RLS 가 부모를 가려 오판하지 않도록 security definer 로 둔다.
-- ------------------------------------------------------------
create or replace function private.reject_direct_delete() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_schema text := tg_argv[0];
  parent_table  text := tg_argv[1];
  child_column  text := tg_argv[2];
  parent_id     uuid := (to_jsonb(old) ->> child_column)::uuid;
  parent_exists boolean;
begin
  if parent_id is null then
    return old;
  end if;
  execute format('select exists (select 1 from %I.%I where id = $1)',
                 parent_schema, parent_table)
    into parent_exists using parent_id;
  if parent_exists then
    raise exception '%.% 행은 직접 삭제할 수 없다. 부모 삭제 Cascade 로만 지운다',
      tg_table_schema, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

revoke all on function private.reject_direct_delete() from public, anon, authenticated;

drop trigger if exists trg_case_events__reject_direct_delete on public.case_events;
create trigger trg_case_events__reject_direct_delete
  before delete on public.case_events
  for each row execute function
    private.reject_direct_delete('public', 'financial_cases', 'case_id');

drop trigger if exists trg_claim_revisions__reject_direct_delete on public.claim_revisions;
create trigger trg_claim_revisions__reject_direct_delete
  before delete on public.claim_revisions
  for each row execute function
    private.reject_direct_delete('public', 'claims', 'claim_id');

drop trigger if exists trg_processing_consents__reject_direct_delete on public.processing_consents;
create trigger trg_processing_consents__reject_direct_delete
  before delete on public.processing_consents
  for each row execute function
    private.reject_direct_delete('public', 'case_inputs', 'case_input_id');

-- ------------------------------------------------------------
-- 6. RLS (명세 9.1)
--    부모 Case 의 deleted_at is null 을 EXISTS 로 확인한다. 복합 FK 는
--    Owner·Case 정합성을 보증하지만 Soft-delete 가시성을 대신하지
--    않는다 (명세 9.1 5번).
-- ------------------------------------------------------------
alter table public.claims              enable row level security;
alter table public.claims              force  row level security;
alter table public.claim_revisions     enable row level security;
alter table public.claim_revisions     force  row level security;
alter table public.processing_consents enable row level security;
alter table public.processing_consents force  row level security;

drop policy if exists claims__select_own on public.claims;
create policy claims__select_own on public.claims
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

drop policy if exists claim_revisions__select_own on public.claim_revisions;
create policy claim_revisions__select_own on public.claim_revisions
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

drop policy if exists processing_consents__select_own on public.processing_consents;
create policy processing_consents__select_own on public.processing_consents
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

-- ------------------------------------------------------------
-- 7. Grant (명세 9.2)
--    Claim Draft 도 회원에게는 SELECT 만 준다. 추출·수정·확정과 동의
--    기록은 서버 RPC 가 담당한다.
-- ------------------------------------------------------------
grant select on public.claims              to authenticated;
grant select on public.claim_revisions     to authenticated;
grant select on public.processing_consents to authenticated;

revoke all on public.claims              from anon;
revoke all on public.claim_revisions     from anon;
revoke all on public.processing_consents from anon;
