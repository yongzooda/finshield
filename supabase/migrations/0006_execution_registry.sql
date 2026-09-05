-- ============================================================
-- 0006 정책·실행 Registry (명세 6.8, 15절 5번 묶음)
--
-- 대상: private.policy_versions, private.agent_definitions,
--       private.tool_definitions, private.agent_tool_allowlists
--
-- 같은 절의 execution_manifests 와 그 Join 은 여기 없다. Manifest 는
-- kb.kb_releases 를 참조하는데 아직 없고, 명세 15 도 Manifest 를 7번
-- 묶음(Claim·Run·Manifest)에 둔다. FK 없는 컬럼을 먼저 만들지 않는다.
--
-- 이 네 표는 불변 Registry 다. 수정은 새 version 행으로만 하고 UPDATE·
-- DELETE 를 모두 막는다. 폐기는 Manifest Event(ACTIVATED|RETIRED)로
-- 표현하며 행을 지우지 않는다.
--
-- 권한: 서버·Worker 는 읽기만 한다 (명세 9.2 private 행). 정의 적재는
-- Migration·운영 Script 가 맡는다. 회원·익명은 접근하지 않는다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enum (명세 4.1)
--    tool_transport 는 여러 표가 공유하는 폐쇄 상태라 Enum 으로 둔다.
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tool_transport') then
    create type public.tool_transport as enum ('FUNCTION', 'MCP');
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. 삭제 차단 Trigger 함수
--    reject_direct_delete 는 부모 Cascade 를 구분하려고 부모를 본다.
--    Registry 는 부모가 없고 어떤 경로로도 지우지 않으므로 무조건 막는다.
-- ------------------------------------------------------------
create or replace function private.reject_delete() returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '%.% 행은 삭제할 수 없다. 폐기는 새 버전과 Manifest Event 로 표현한다',
    tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function private.reject_delete() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. private.policy_versions (명세 6.8)
-- ------------------------------------------------------------
create table if not exists private.policy_versions (
  id             uuid primary key default gen_random_uuid(),
  policy_type    text not null,
  version        text not null,
  rules          jsonb not null,
  schema_version text not null,
  content_hash   text not null,
  created_at     timestamptz not null default now(),

  constraint uq_policy_versions__type_version unique (policy_type, version),

  constraint ck_policy_versions__policy_type
    check (policy_type in ('EVIDENCE', 'RESULT_MATRIX', 'COVERAGE', 'PROFILE',
                           'PII', 'RETENTION')),
  constraint ck_policy_versions__version_len
    check (octet_length(version) between 1 and 32),
  constraint ck_policy_versions__schema_version_len
    check (octet_length(schema_version) between 1 and 32),
  constraint ck_policy_versions__rules_object
    check (jsonb_typeof(rules) = 'object'),
  constraint ck_policy_versions__content_hash
    check (content_hash ~ '^[0-9a-f]{64}$')
);

comment on table private.policy_versions is
  '기계 실행 가능한 불변 정책 버전. Evidence·Result Matrix·Coverage·Profile·PII·Retention (명세 6.8)';
comment on column private.policy_versions.rules is
  'Secret·PII·원본을 넣지 않는다. Coverage 정책은 시나리오별 필수 Claim 유형·제외 사유·분모를 담는다';

-- ------------------------------------------------------------
-- 4. private.agent_definitions (명세 6.8)
--    role 은 요구사항 4절 흐름의 Agent 종류다. 명세 표가 값을 열거하지
--    않아 4.1 규칙대로 여기서 CHECK 로 고정하고 명세 표에도 적었다.
-- ------------------------------------------------------------
create table if not exists private.agent_definitions (
  id                    uuid primary key default gen_random_uuid(),
  agent_code            text not null,
  version               text not null,
  input_schema_version  text not null,
  output_schema_version text not null,
  prompt_version        text not null,
  role                  text not null,
  definition_hash       text not null,
  created_at            timestamptz not null default now(),

  constraint uq_agent_definitions__code_version unique (agent_code, version),

  constraint ck_agent_definitions__agent_code
    check (agent_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint ck_agent_definitions__version_len
    check (octet_length(version) between 1 and 32),
  constraint ck_agent_definitions__schema_versions_len
    check (octet_length(input_schema_version) between 1 and 32
           and octet_length(output_schema_version) between 1 and 32
           and octet_length(prompt_version) between 1 and 64),
  constraint ck_agent_definitions__role
    check (role in ('ORCHESTRATOR', 'INTAKE', 'DOMAIN', 'COVE', 'RED_TEAM',
                    'EVIDENCE_JUDGE', 'ACTION_GUIDE')),
  constraint ck_agent_definitions__definition_hash
    check (definition_hash ~ '^[0-9a-f]{64}$')
);

comment on table private.agent_definitions is
  '불변 Agent 정의. 별도 입력·출력 Schema 와 Prompt 버전을 가진다 (규칙 2, 명세 6.8)';
comment on column private.agent_definitions.role is
  'ORCHESTRATOR·INTAKE·DOMAIN·COVE·RED_TEAM·EVIDENCE_JUDGE·ACTION_GUIDE. 화면 표시용 이름이 아니라 실행 역할이다';

-- ------------------------------------------------------------
-- 5. private.tool_definitions (명세 6.8)
--    timeout 은 ADR 9.2 의 Image·PDF Run deadline 180초를 넘을 수 없다.
--    한 Tool 이 Run 전체보다 오래 기다리는 정의를 만들지 못하게 한다.
-- ------------------------------------------------------------
create table if not exists private.tool_definitions (
  id                    uuid primary key default gen_random_uuid(),
  tool_code             text not null,
  version               text not null,
  transport             public.tool_transport not null,
  input_schema_version  text not null,
  output_schema_version text not null,
  max_payload_bytes     integer not null,
  max_batch_size        integer not null,
  timeout_ms            integer not null,
  retry_limit           integer not null,
  definition_hash       text not null,
  created_at            timestamptz not null default now(),

  constraint uq_tool_definitions__code_version unique (tool_code, version),

  constraint ck_tool_definitions__tool_code
    check (tool_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint ck_tool_definitions__version_len
    check (octet_length(version) between 1 and 32),
  constraint ck_tool_definitions__schema_versions_len
    check (octet_length(input_schema_version) between 1 and 32
           and octet_length(output_schema_version) between 1 and 32),
  constraint ck_tool_definitions__max_payload_bytes
    check (max_payload_bytes between 1 and 10485760),
  constraint ck_tool_definitions__max_batch_size
    check (max_batch_size between 1 and 1000),
  constraint ck_tool_definitions__timeout_ms
    check (timeout_ms between 1 and 180000),
  constraint ck_tool_definitions__retry_limit
    check (retry_limit between 0 and 5),
  constraint ck_tool_definitions__definition_hash
    check (definition_hash ~ '^[0-9a-f]{64}$')
);

comment on table private.tool_definitions is
  '불변 Tool 정의와 오류·크기·시간 계약. 실제 MCP Client 호출만 MCP 로 표시한다 (명세 6.8)';

-- ------------------------------------------------------------
-- 6. private.agent_tool_allowlists (명세 6.8)
--    미등록 Tool 호출 차단의 근거 표. Agent 가 어떤 목적으로 어떤 Tool
--    버전을 부를 수 있는지 고정한다.
-- ------------------------------------------------------------
create table if not exists private.agent_tool_allowlists (
  agent_definition_id uuid not null,
  tool_definition_id  uuid not null,
  purpose_code        text not null,
  created_at          timestamptz not null default now(),

  constraint pk_agent_tool_allowlists
    primary key (agent_definition_id, tool_definition_id, purpose_code),
  constraint fk_agent_tool_allowlists__agent
    foreign key (agent_definition_id) references private.agent_definitions (id),
  constraint fk_agent_tool_allowlists__tool
    foreign key (tool_definition_id) references private.tool_definitions (id),

  constraint ck_agent_tool_allowlists__purpose_code
    check (purpose_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

comment on table private.agent_tool_allowlists is
  'Agent 별 Tool Allowlist. 여기 없는 Tool 호출은 실행 계층이 거부한다 (규칙 2, 명세 6.8)';

-- ------------------------------------------------------------
-- 7. 불변성 Trigger
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['policy_versions', 'agent_definitions',
                           'tool_definitions', 'agent_tool_allowlists'] loop
    execute format('drop trigger if exists trg_%s__reject_update on private.%I', t, t);
    execute format('create trigger trg_%s__reject_update before update on private.%I '
                   'for each row execute function private.reject_update()', t, t);
    execute format('drop trigger if exists trg_%s__reject_delete on private.%I', t, t);
    execute format('create trigger trg_%s__reject_delete before delete on private.%I '
                   'for each row execute function private.reject_delete()', t, t);
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 8. RLS 와 Grant (명세 9.1, 9.2)
--
--    Registry 는 사용자 소유 데이터가 아니라 전역 설정이다. 그래도 모든
--    표에 RLS enable+force 를 두는 운영 불변식을 지키고, 서버·Worker 의
--    읽기만 정책으로 연다. 쓰기 정책은 없다. 적재는 bypassrls 를 가진
--    Migration 경로가 한다.
-- ------------------------------------------------------------
alter table private.policy_versions       enable row level security;
alter table private.policy_versions       force  row level security;
alter table private.agent_definitions     enable row level security;
alter table private.agent_definitions     force  row level security;
alter table private.tool_definitions      enable row level security;
alter table private.tool_definitions      force  row level security;
alter table private.agent_tool_allowlists enable row level security;
alter table private.agent_tool_allowlists force  row level security;

drop policy if exists policy_versions__worker_read on private.policy_versions;
create policy policy_versions__worker_read on private.policy_versions
  for select to finshield_worker using (true);
drop policy if exists agent_definitions__worker_read on private.agent_definitions;
create policy agent_definitions__worker_read on private.agent_definitions
  for select to finshield_worker using (true);
drop policy if exists tool_definitions__worker_read on private.tool_definitions;
create policy tool_definitions__worker_read on private.tool_definitions
  for select to finshield_worker using (true);
drop policy if exists agent_tool_allowlists__worker_read on private.agent_tool_allowlists;
create policy agent_tool_allowlists__worker_read on private.agent_tool_allowlists
  for select to finshield_worker using (true);

grant select on private.policy_versions       to finshield_worker;
grant select on private.agent_definitions     to finshield_worker;
grant select on private.tool_definitions      to finshield_worker;
grant select on private.agent_tool_allowlists to finshield_worker;

revoke all on private.policy_versions       from anon, authenticated;
revoke all on private.agent_definitions     from anon, authenticated;
revoke all on private.tool_definitions      from anon, authenticated;
revoke all on private.agent_tool_allowlists from anon, authenticated;
