-- ============================================================
-- 0004 FinancialCase·입력 (명세 6.2)
--
-- 대상: financial_cases, case_inputs, case_input_pages,
--       case_input_findings, private.input_objects,
--       private.ocr_artifacts, case_events
--
-- 0003 이 만든 profiles·financial_profile_versions 와
-- private.set_updated_at()·private.reject_update() 를 전제로 한다.
--
-- 권한 모델은 명세 9.2 를 따른다. Case·입력은 회원에게 SELECT 만
-- 준다. 생성·변경은 서버 RPC 와 Worker 경로가 담당한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
--    Namespace 가 다르면 값이 같아도 별도 타입으로 만든다.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'case_scenario') then
    create type public.case_scenario as enum ('LOAN', 'SAVINGS', 'INVESTMENT');
  end if;
  if not exists (select 1 from pg_type where typname = 'case_input_type') then
    create type public.case_input_type as enum ('TEXT', 'IMAGE', 'PDF', 'URL');
  end if;
  if not exists (select 1 from pg_type where typname = 'case_lifecycle') then
    create type public.case_lifecycle as enum (
      'DRAFT', 'INPUT_REVIEW', 'VERIFYING', 'VERIFIED',
      'NEED_MORE_INFORMATION', 'STOPPED_BY_USER', 'CLOSED');
  end if;
  if not exists (select 1 from pg_type where typname = 'case_resume_state') then
    create type public.case_resume_state as enum ('DRAFT', 'INPUT_REVIEW');
  end if;
  if not exists (select 1 from pg_type where typname = 'journey_stage') then
    create type public.journey_stage as enum (
      'PRE_TRANSACTION', 'ENROLLED', 'FUNDS_SENT_OR_DAMAGE_SUSPECTED');
  end if;
  if not exists (select 1 from pg_type where typname = 'aftercare_status') then
    create type public.aftercare_status as enum (
      'NOT_STARTED', 'IN_PROGRESS', 'ACTION_REQUIRED', 'COMPLETED');
  end if;
  if not exists (select 1 from pg_type where typname = 'input_stage') then
    create type public.input_stage as enum (
      'QUARANTINED', 'VALIDATED', 'EXTRACTED', 'MASKED',
      'CLAIM_CONFIRMED', 'RAW_DELETED');
  end if;
  if not exists (select 1 from pg_type where typname = 'input_outcome') then
    create type public.input_outcome as enum (
      'ACTIVE', 'REJECTED', 'BLOCKED', 'FAILED', 'CANCELLED');
  end if;
  if not exists (select 1 from pg_type where typname = 'raw_delete_status') then
    create type public.raw_delete_status as enum (
      'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. public.financial_cases (명세 6.2)
--
--    latest_successful_run_id·latest_passport_id 는 조회 최적화
--    포인터다. 참조 대상인 verification_runs·passports 는 6.4·6.5
--    Migration 에서 만들므로 그때 교차 소유 복합 FK 를 추가한다.
--    여기서 컬럼만 두고 FK 없이 남기지 않도록 후속 Migration 이
--    반드시 FK 를 붙인다.
-- ------------------------------------------------------------
create table if not exists public.financial_cases (
  id                         uuid primary key default gen_random_uuid(),
  owner_id                   uuid not null,
  scenario                   public.case_scenario not null,
  primary_input_type         public.case_input_type,
  title_masked               text not null,
  lifecycle                  public.case_lifecycle not null default 'DRAFT',
  resume_state               public.case_resume_state,
  journey_stage              public.journey_stage not null default 'PRE_TRANSACTION',
  enrollment_confirmed_at    timestamptz,
  aftercare_status           public.aftercare_status not null default 'NOT_STARTED',
  initial_profile_version_id uuid not null,
  latest_successful_run_id   uuid,
  latest_passport_id         uuid,
  lock_version               integer not null default 1,
  deletion_status            text not null default 'ACTIVE',
  deleted_at                 timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint fk_financial_cases__profiles
    foreign key (owner_id) references public.profiles (id) on delete cascade,
  -- 참조 Case 가 있는 동안 Snapshot 을 지울 수 없다 (명세 5.3).
  constraint fk_financial_cases__profile_versions
    foreign key (initial_profile_version_id, owner_id)
    references public.financial_profile_versions (id, owner_id) on delete restrict,

  constraint uq_financial_cases__id_owner_id unique (id, owner_id),

  constraint ck_financial_cases__title_masked_len
    check (char_length(title_masked) between 1 and 160
           and octet_length(title_masked) <= 640),
  constraint ck_financial_cases__lock_version check (lock_version > 0),
  constraint ck_financial_cases__deletion_status
    check (deletion_status in ('ACTIVE', 'PENDING', 'PURGING', 'FAILED')),
  -- 삭제 축과 시각을 함께 움직인다. ACTIVE 인데 deleted_at 이 있거나
  -- 그 반대인 상태를 만들지 않는다.
  constraint ck_financial_cases__deleted_at_pairing
    check ((deletion_status = 'ACTIVE') = (deleted_at is null)),
  -- resume_state 는 중단·종료 상태에서만 의미가 있다 (명세 6.2).
  constraint ck_financial_cases__resume_state_scope
    check (resume_state is null
           or lifecycle in ('STOPPED_BY_USER', 'CLOSED')),
  -- 가입 확인 축. 명세 6.7 은 "피해 의심만 있고 가입 확인 Event 가
  -- 없으면 가입으로 간주하지 않는다" 고 정한다. 따라서
  -- FUNDS_SENT_OR_DAMAGE_SUSPECTED 는 가입 확인 없이도 성립한다.
  constraint ck_financial_cases__enrollment_not_before_journey
    check (journey_stage <> 'PRE_TRANSACTION' or enrollment_confirmed_at is null),
  constraint ck_financial_cases__enrolled_requires_confirmation
    check (journey_stage <> 'ENROLLED' or enrollment_confirmed_at is not null),
  -- P0 는 URL 입력을 만들지 않는다.
  constraint ck_financial_cases__no_url_in_p0
    check (primary_input_type is null or primary_input_type <> 'URL')
);

comment on table public.financial_cases is
  'FinancialCase 루트. 검증·가입·Aftercare 를 서로 다른 축으로 보관한다 (명세 6.2)';
comment on column public.financial_cases.title_masked is
  '목록 표시용 마스킹 제목. PII 를 넣지 않는다';
comment on column public.financial_cases.latest_successful_run_id is
  '조회 최적화 포인터. 결과 정본이 아니며 최종화 함수만 갱신한다. FK 는 6.4 Migration 에서 추가';
comment on column public.financial_cases.latest_passport_id is
  '조회 최적화 포인터. FK 는 6.5 Migration 에서 추가';

create index if not exists idx_financial_cases__owner_id_created_at
  on public.financial_cases (owner_id, created_at desc)
  where deleted_at is null;

-- ------------------------------------------------------------
-- 3. public.case_inputs (명세 6.2)
--
--    input_type 을 복합 UNIQUE 에 포함한다. private.input_objects 가
--    이 조합을 참조하고 자기 쪽에서 TEXT 를 거부하면, Text 입력에
--    Storage 객체가 붙지 않는다는 명세 제약이 DB 에서 강제된다.
-- ------------------------------------------------------------
create table if not exists public.case_inputs (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null,
  case_id                 uuid not null,
  input_type              public.case_input_type not null,
  input_stage             public.input_stage not null,
  input_outcome           public.input_outcome not null default 'ACTIVE',
  raw_delete_status       public.raw_delete_status not null,
  declared_mime           text,
  detected_mime           text,
  magic_signature         text,
  size_bytes              bigint,
  page_count              integer,
  masked_text             text,
  masked_text_hash        text,
  pii_policy_version      text,
  pii_scan_status         text not null,
  external_ocr_consent_id uuid,
  claim_confirmed_at      timestamptz,
  raw_delete_requested_at timestamptz,
  raw_deleted_at          timestamptz,
  raw_expires_at          timestamptz not null,
  error_code              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint fk_case_inputs__financial_cases
    foreign key (case_id, owner_id)
    references public.financial_cases (id, owner_id) on delete cascade,

  constraint uq_case_inputs__id_owner_case unique (id, owner_id, case_id),
  constraint uq_case_inputs__id_owner_case_type
    unique (id, owner_id, case_id, input_type),

  -- P0 는 URL 직접 수집을 하지 않는다. P1 Feature Gate 를 켜는
  -- Migration 에서 이 제약을 제거한다 (명세 6.2).
  constraint ck_case_inputs__no_url_in_p0 check (input_type <> 'URL'),

  constraint ck_case_inputs__declared_mime_len
    check (declared_mime is null or octet_length(declared_mime) <= 128),
  constraint ck_case_inputs__detected_mime_len
    check (detected_mime is null or octet_length(detected_mime) <= 128),
  constraint ck_case_inputs__magic_signature_len
    check (magic_signature is null or octet_length(magic_signature) <= 64),
  constraint ck_case_inputs__error_code_len
    check (error_code is null or octet_length(error_code) <= 64),
  -- 마스킹 결과만 영속한다. 전체 원본을 넣지 않는다 (명세 6.2).
  constraint ck_case_inputs__masked_text_len
    check (masked_text is null or octet_length(masked_text) <= 262144),
  constraint ck_case_inputs__masked_text_hash
    check (masked_text_hash is null or masked_text_hash ~ '^[0-9a-f]{64}$'),
  -- 영속 masked_text 는 MASKED 이후에만 기록한다 (명세 4.3). Text 입력의
  -- 원본 문자열도 마스킹 전에는 private 임시 영역에만 둔다.
  constraint ck_case_inputs__masked_text_stage
    check (masked_text is null
           or input_stage in ('MASKED', 'CLAIM_CONFIRMED', 'RAW_DELETED')),
  -- PII Gate 를 통과하지 않은 텍스트를 영속하지 않는다 (규칙 4).
  constraint ck_case_inputs__masked_text_requires_pii_pass
    check (masked_text is null or pii_scan_status = 'PASSED'),

  constraint ck_case_inputs__size_bytes
    check (size_bytes is null or size_bytes between 0 and 10485760),
  constraint ck_case_inputs__page_count
    check (page_count is null or page_count between 1 and 10),
  -- Image 는 1쪽, PDF 는 10쪽 상한, Text 는 쪽수·크기를 갖지 않는다.
  constraint ck_case_inputs__page_count_by_type
    check (case input_type
             when 'IMAGE' then page_count = 1 and size_bytes is not null
             when 'PDF'   then page_count between 1 and 10 and size_bytes is not null
             when 'TEXT'  then page_count is null
             else true
           end),

  constraint ck_case_inputs__pii_scan_status
    check (pii_scan_status in ('PENDING', 'PASSED', 'BLOCKED')),

  -- 원본은 생성 후 24시간을 넘겨 보관하지 않는다 (명세 6.2, 규칙 4).
  constraint ck_case_inputs__raw_expires_at
    check (raw_expires_at <= created_at + interval '24 hours'),

  -- 순방향: RAW_DELETED 단계는 삭제 성공과 확인 시각을 요구한다.
  constraint ck_case_inputs__raw_deleted_stage
    check (input_stage <> 'RAW_DELETED'
           or (raw_delete_status = 'SUCCEEDED' and raw_deleted_at is not null)),
  -- 역방향은 정상 경로에서만 적용한다. 조기 중단·실패·삭제는 마지막
  -- 처리 단계를 보존한 채 삭제 축만 종결한다 (명세 6.2).
  constraint ck_case_inputs__raw_deleted_stage_reverse
    check (not (raw_delete_status = 'SUCCEEDED'
                and input_outcome = 'ACTIVE'
                and claim_confirmed_at is not null)
           or input_stage = 'RAW_DELETED'),
  constraint ck_case_inputs__raw_deleted_at_pairing
    check ((raw_deleted_at is not null) = (raw_delete_status = 'SUCCEEDED'))
);

comment on table public.case_inputs is
  '입력 단위. 처리 단계·결과 축·원본 삭제 축을 분리한다 (명세 6.2)';
comment on column public.case_inputs.magic_signature is
  '허용 Signature Code 만 저장한다. 원본 byte 를 넣지 않는다';
comment on column public.case_inputs.masked_text is
  'PII Gate 통과 뒤의 마스킹 텍스트. 원본 전문을 넣지 않는다';

create index if not exists idx_case_inputs__case_id_created_at
  on public.case_inputs (case_id, created_at);
create index if not exists idx_case_inputs__raw_expires_at
  on public.case_inputs (raw_expires_at)
  where raw_delete_status <> 'SUCCEEDED';

-- ------------------------------------------------------------
-- 4. public.case_input_pages (명세 6.2)
-- ------------------------------------------------------------
create table if not exists public.case_input_pages (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null,
  case_id                uuid not null,
  case_input_id          uuid not null,
  page_no                integer not null,
  parse_status           text not null,
  width                  integer,
  height                 integer,
  masked_text            text,
  locator_schema_version text not null,
  low_confidence_count   integer not null default 0,
  error_code             text,
  created_at             timestamptz not null default now(),

  constraint fk_case_input_pages__case_inputs
    foreign key (case_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,

  constraint uq_case_input_pages__input_page unique (case_input_id, page_no),
  constraint uq_case_input_pages__id_owner_case_input
    unique (id, owner_id, case_id, case_input_id),

  constraint ck_case_input_pages__page_no check (page_no between 1 and 10),
  constraint ck_case_input_pages__parse_status
    check (parse_status in ('PENDING', 'SUCCEEDED', 'FAILED', 'BLOCKED')),
  constraint ck_case_input_pages__width check (width is null or width > 0),
  constraint ck_case_input_pages__height check (height is null or height > 0),
  constraint ck_case_input_pages__masked_text_len
    check (masked_text is null or octet_length(masked_text) <= 65536),
  constraint ck_case_input_pages__low_confidence_count
    check (low_confidence_count >= 0),
  constraint ck_case_input_pages__error_code_len
    check (error_code is null or octet_length(error_code) <= 64)
);

comment on table public.case_input_pages is
  '페이지·Image 단위 파싱 결과. P0 가 페이지별 재시도를 제공하지 않아도 Claim 위치와 실패 범위를 보존한다 (명세 6.2)';

-- ------------------------------------------------------------
-- 5. public.case_input_findings (명세 6.2)
--    탐지된 값 자체를 저장하지 않는다. 유형·위치·심각도만 남긴다.
-- ------------------------------------------------------------
create table if not exists public.case_input_findings (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  case_id       uuid not null,
  case_input_id uuid not null,
  page_id       uuid,
  finding_type  text not null,
  finding_code  text not null,
  locator       jsonb not null,
  severity      text not null,
  resolution    text not null,
  created_at    timestamptz not null default now(),

  constraint fk_case_input_findings__case_inputs
    foreign key (case_input_id, owner_id, case_id)
    references public.case_inputs (id, owner_id, case_id) on delete cascade,
  constraint fk_case_input_findings__pages
    foreign key (page_id, owner_id, case_id, case_input_id)
    references public.case_input_pages (id, owner_id, case_id, case_input_id)
    on delete cascade,

  constraint ck_case_input_findings__finding_type
    check (finding_type in ('PII', 'LOW_CONFIDENCE', 'INJECTION', 'UNSAFE_FILE')),
  constraint ck_case_input_findings__finding_code_len
    check (octet_length(finding_code) between 1 and 64),
  constraint ck_case_input_findings__locator_object
    check (jsonb_typeof(locator) = 'object'),
  constraint ck_case_input_findings__locator_schema_version
    check (locator ? 'schema_version'),
  constraint ck_case_input_findings__severity
    check (severity in ('INFO', 'WARNING', 'BLOCKING')),
  constraint ck_case_input_findings__resolution
    check (resolution in ('OPEN', 'MASKED', 'EXCLUDED', 'REJECTED'))
);

comment on table public.case_input_findings is
  '안전·품질 Finding. 주민번호·전화·계좌 원문과 Injection 문구 전문을 저장하지 않는다 (명세 6.2)';

create index if not exists idx_case_input_findings__input_severity
  on public.case_input_findings (case_input_id, severity);

-- ------------------------------------------------------------
-- 6. private.input_objects (명세 6.2)
--
--    input_type 을 함께 참조해 TEXT 입력에는 Storage 객체가 생기지
--    않도록 DB 가 직접 거부한다.
-- ------------------------------------------------------------
create table if not exists private.input_objects (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null,
  case_id           uuid not null,
  case_input_id     uuid not null,
  input_type        public.case_input_type not null,
  bucket_id         text not null,
  object_path       text not null,
  safe_extension    text not null,
  encryption_state  text not null,
  access_blocked_at timestamptz,
  expires_at        timestamptz not null,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),

  constraint fk_input_objects__case_inputs
    foreign key (case_input_id, owner_id, case_id, input_type)
    references public.case_inputs (id, owner_id, case_id, input_type)
    on delete cascade,

  constraint uq_input_objects__object_path unique (object_path),

  constraint ck_input_objects__no_text_object check (input_type <> 'TEXT'),
  constraint ck_input_objects__bucket_id check (bucket_id = 'finshield-quarantine'),
  -- 경로 조작을 거부한다. 정확한 segment 구성은 6.1 Upload 경로와
  -- 6.2 표가 아직 서로 다르므로 여기서 고정하지 않는다.
  constraint ck_input_objects__object_path_len
    check (octet_length(object_path) between 1 and 512),
  constraint ck_input_objects__object_path_safe
    check (object_path ~ '^[A-Za-z0-9/._-]+$'
           and object_path !~ '(^|/)\.\.(/|$)'
           and object_path !~ '^/' and object_path !~ '//'),
  constraint ck_input_objects__safe_extension
    check (safe_extension in ('jpg', 'jpeg', 'png', 'pdf')),
  constraint ck_input_objects__encryption_state
    check (encryption_state in ('UNKNOWN', 'VERIFIED', 'FAILED')),
  constraint ck_input_objects__expires_at
    check (expires_at <= created_at + interval '24 hours')
);

comment on table private.input_objects is
  '격리 Bucket 임시 객체 메타데이터. 원본 파일명·이메일·원본 Hash 를 저장하지 않는다 (명세 6.2)';
comment on column private.input_objects.access_blocked_at is
  '삭제 요청 즉시 Signed URL 발급을 차단한 시각';

create index if not exists idx_input_objects__expires_at
  on private.input_objects (expires_at)
  where deleted_at is null;

-- ------------------------------------------------------------
-- 7. private.ocr_artifacts (명세 6.2)
--    OCR 원문을 넣지 않는다. 부재 확인을 남기기 위한 메타데이터다.
-- ------------------------------------------------------------
create table if not exists private.ocr_artifacts (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null,
  case_id                uuid not null,
  case_input_id          uuid not null,
  page_id                uuid not null,
  provider_code          text,
  provider_request_token text,
  storage_object_path    text,
  status                 text not null,
  access_blocked_at      timestamptz,
  deleted_at             timestamptz,
  expires_at             timestamptz not null,
  error_code             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint fk_ocr_artifacts__pages
    foreign key (page_id, owner_id, case_id, case_input_id)
    references public.case_input_pages (id, owner_id, case_id, case_input_id)
    on delete cascade,

  constraint ck_ocr_artifacts__provider_code_len
    check (provider_code is null or octet_length(provider_code) <= 64),
  constraint ck_ocr_artifacts__provider_request_token_len
    check (provider_request_token is null
           or octet_length(provider_request_token) <= 128),
  constraint ck_ocr_artifacts__storage_object_path_len
    check (storage_object_path is null
           or octet_length(storage_object_path) <= 512),
  constraint ck_ocr_artifacts__status
    check (status in ('PROCESSING', 'AVAILABLE', 'DELETE_REQUESTED',
                      'DELETED', 'FAILED')),
  constraint ck_ocr_artifacts__error_code_len
    check (error_code is null or octet_length(error_code) <= 64),
  constraint ck_ocr_artifacts__expires_at
    check (expires_at <= created_at + interval '24 hours'),
  constraint ck_ocr_artifacts__deleted_at_pairing
    check ((deleted_at is not null) = (status = 'DELETED'))
);

comment on table private.ocr_artifacts is
  'OCR 중간물 삭제 추적 메타데이터. 원문과 Credential 을 저장하지 않는다 (명세 6.2)';
comment on column private.ocr_artifacts.provider_request_token is
  '비가역 요청 식별자. Provider Credential 과 원문 ID 를 넣지 않는다';

create index if not exists idx_ocr_artifacts__expires_at
  on private.ocr_artifacts (expires_at)
  where status <> 'DELETED';

-- ------------------------------------------------------------
-- 8. public.case_events (명세 6.2)
--    Append-only Timeline. Case 전체 삭제 외의 UPDATE·DELETE 를
--    허용하지 않는다.
-- ------------------------------------------------------------
create table if not exists public.case_events (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null,
  case_id                uuid not null,
  event_no               bigint not null,
  event_type             text not null,
  actor_type             text not null,
  actor_ref              uuid,
  from_state             text,
  to_state               text,
  correction_of_event_id uuid,
  payload                jsonb not null,
  idempotency_key        text not null,
  created_at             timestamptz not null default now(),

  constraint fk_case_events__financial_cases
    foreign key (case_id, owner_id)
    references public.financial_cases (id, owner_id) on delete cascade,
  -- 정정 대상은 같은 Owner·Case 안에서만 지정한다 (명세 5.1).
  constraint fk_case_events__correction_of
    foreign key (correction_of_event_id, owner_id, case_id)
    references public.case_events (id, owner_id, case_id) on delete cascade,

  constraint uq_case_events__case_event_no unique (case_id, event_no),
  constraint uq_case_events__id_owner_case unique (id, owner_id, case_id),
  constraint uq_case_events__idempotency
    unique (owner_id, case_id, idempotency_key),

  constraint ck_case_events__event_no check (event_no > 0),
  constraint ck_case_events__event_type
    check (event_type ~ '^(CASE|JOURNEY|AFTERCARE|RUN|REVALIDATION)_[A-Z0-9_]{1,48}$'),
  constraint ck_case_events__actor_type
    check (actor_type in ('USER', 'SYSTEM', 'AGENT')),
  constraint ck_case_events__from_state_len
    check (from_state is null or octet_length(from_state) <= 64),
  constraint ck_case_events__to_state_len
    check (to_state is null or octet_length(to_state) <= 64),
  constraint ck_case_events__payload_object
    check (jsonb_typeof(payload) = 'object'),
  constraint ck_case_events__payload_schema_version
    check (payload ? 'schema_version'),
  constraint ck_case_events__idempotency_key_len
    check (octet_length(idempotency_key) between 1 and 128),
  constraint ck_case_events__no_self_correction
    check (correction_of_event_id is null or correction_of_event_id <> id)
);

comment on table public.case_events is
  'Case Append-only Timeline. 가입일·채널·정정 이유를 정해진 Payload Schema 로 남긴다 (명세 6.2)';

create index if not exists idx_case_events__case_id_event_no
  on public.case_events (case_id, event_no desc);

-- ------------------------------------------------------------
-- 9. Trigger
--    updated_at 은 0003 의 private.set_updated_at() 을 재사용한다.
--    case_events 는 0003 의 private.reject_update() 로 불변을 강제한다.
--    두 함수 모두 security invoker + search_path = '' 다.
-- ------------------------------------------------------------
drop trigger if exists trg_financial_cases__updated_at on public.financial_cases;
create trigger trg_financial_cases__updated_at
  before update on public.financial_cases
  for each row execute function private.set_updated_at();

drop trigger if exists trg_case_inputs__updated_at on public.case_inputs;
create trigger trg_case_inputs__updated_at
  before update on public.case_inputs
  for each row execute function private.set_updated_at();

drop trigger if exists trg_ocr_artifacts__updated_at on private.ocr_artifacts;
create trigger trg_ocr_artifacts__updated_at
  before update on private.ocr_artifacts
  for each row execute function private.set_updated_at();

drop trigger if exists trg_case_events__reject_update on public.case_events;
create trigger trg_case_events__reject_update
  before update on public.case_events
  for each row execute function private.reject_update();

-- ------------------------------------------------------------
-- 10. RLS (명세 9.1)
--     FORCE 로 소유자에게도 정책을 적용한다. postgres·service_role 은
--     bypassrls 라 여전히 우회하므로 서버 코드가 Owner 조건을 직접
--     건다 (명세 9.1 6번).
--
--     Case 자식 정책은 owner_id 직접 비교에 더해 부모 Case 의
--     deleted_at is null 을 EXISTS 로 확인한다. 복합 FK 는 Owner·Case
--     정합성을 보증하지만 Soft-delete 가시성을 대신하지 않는다
--     (명세 9.1 5번).
-- ------------------------------------------------------------
alter table public.financial_cases     enable row level security;
alter table public.financial_cases     force  row level security;
alter table public.case_inputs         enable row level security;
alter table public.case_inputs         force  row level security;
alter table public.case_input_pages    enable row level security;
alter table public.case_input_pages    force  row level security;
alter table public.case_input_findings enable row level security;
alter table public.case_input_findings force  row level security;
alter table public.case_events         enable row level security;
alter table public.case_events         force  row level security;
alter table private.input_objects      enable row level security;
alter table private.input_objects      force  row level security;
alter table private.ocr_artifacts      enable row level security;
alter table private.ocr_artifacts      force  row level security;

drop policy if exists financial_cases__select_own on public.financial_cases;
create policy financial_cases__select_own on public.financial_cases
  for select to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is null);

drop policy if exists case_inputs__select_own on public.case_inputs;
create policy case_inputs__select_own on public.case_inputs
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

drop policy if exists case_input_pages__select_own on public.case_input_pages;
create policy case_input_pages__select_own on public.case_input_pages
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

drop policy if exists case_input_findings__select_own on public.case_input_findings;
create policy case_input_findings__select_own on public.case_input_findings
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

drop policy if exists case_events__select_own on public.case_events;
create policy case_events__select_own on public.case_events
  for select to authenticated
  using (owner_id = (select auth.uid())
         and exists (select 1 from public.financial_cases c
                      where c.id = case_id
                        and c.owner_id = (select auth.uid())
                        and c.deleted_at is null));

-- private 두 테이블에는 authenticated 정책을 만들지 않는다. RLS 를
-- 켜고 정책이 없으면 bypassrls 가 아닌 모든 역할의 접근이 거부된다.

-- ------------------------------------------------------------
-- 11. Grant (명세 9.2)
--     회원은 Case·입력을 읽기만 한다. 생성·변경은 검증 RPC 와
--     서버 Worker 경로가 담당하므로 여기서 쓰기 권한을 주지 않는다.
-- ------------------------------------------------------------
grant select on public.financial_cases     to authenticated;
grant select on public.case_inputs         to authenticated;
grant select on public.case_input_pages    to authenticated;
grant select on public.case_input_findings to authenticated;
grant select on public.case_events         to authenticated;

revoke all on public.financial_cases     from anon;
revoke all on public.case_inputs         from anon;
revoke all on public.case_input_pages    from anon;
revoke all on public.case_input_findings from anon;
revoke all on public.case_events         from anon;

-- private 스키마는 회원·익명이 접근하지 않는다 (명세 9.2).
revoke all on private.input_objects  from anon, authenticated;
revoke all on private.ocr_artifacts  from anon, authenticated;
