-- ============================================================
-- 0006 Registry 불변식 시험 (명세 6.8, 9.2)
--
-- 01·02 가 만든 시험 데이터와 무관하다. Registry 는 사용자 소유가 아니다.
-- ============================================================

-- Worker 역할로 바꾼 뒤에도 시험 보조 함수를 호출해야 한다.
grant usage on schema fstest to finshield_worker;
grant execute on function fstest.expect_fail(text, text) to finshield_worker;
grant execute on function fstest.expect_ok(text, text)   to finshield_worker;

\echo '12. policy_versions'
insert into private.policy_versions (id, policy_type, version, rules, schema_version, content_hash)
values ('00000000-0000-4000-8000-0000000000e0', 'COVERAGE', 'v1',
        '{"schema_version":"1","required_claim_types":["INSTITUTION","PRODUCT"]}'::jsonb,
        'v1', repeat('a', 64));

select fstest.expect_fail($sql$
  insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
  values ('COVERAGE', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', repeat('b', 64))
$sql$, '같은 유형·버전 중복');

select fstest.expect_fail($sql$
  insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
  values ('MARKETING', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', repeat('b', 64))
$sql$, '열거하지 않은 policy_type');

select fstest.expect_fail($sql$
  insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
  values ('PII', 'v1', '["not","object"]'::jsonb, 'v1', repeat('b', 64))
$sql$, 'rules 가 object 가 아님');

select fstest.expect_fail($sql$
  insert into private.policy_versions (policy_type, version, rules, schema_version, content_hash)
  values ('PII', 'v1', '{"schema_version":"1"}'::jsonb, 'v1', 'not-a-hash')
$sql$, 'content_hash 형식 위반');

select fstest.expect_fail($sql$
  update private.policy_versions set version = 'v2'
   where id = '00000000-0000-4000-8000-0000000000e0'
$sql$, '정책 버전 UPDATE');

select fstest.expect_fail($sql$
  delete from private.policy_versions
   where id = '00000000-0000-4000-8000-0000000000e0'
$sql$, '정책 버전 DELETE');

\echo '13. agent_definitions, tool_definitions'
insert into private.agent_definitions
  (id, agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
values ('00000000-0000-4000-8000-0000000000a0', 'PRODUCT_INSTITUTION', 'v1', 'in-v1', 'out-v1', 'p-v1',
        'DOMAIN', repeat('c', 64)),
       ('00000000-0000-4000-8000-0000000000a9', 'EVIDENCE_JUDGE', 'v1', 'in-v1', 'out-v1', 'p-v1',
        'EVIDENCE_JUDGE', repeat('d', 64));

select fstest.expect_fail($sql$
  insert into private.agent_definitions
    (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
  values ('PRODUCT_INSTITUTION', 'v1', 'in-v1', 'out-v1', 'p-v2', 'DOMAIN', repeat('e', 64))
$sql$, '같은 agent_code·version 중복');

select fstest.expect_fail($sql$
  insert into private.agent_definitions
    (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
  values ('CHAT_HELPER', 'v1', 'in-v1', 'out-v1', 'p-v1', 'ASSISTANT', repeat('e', 64))
$sql$, '열거하지 않은 role');

select fstest.expect_fail($sql$
  insert into private.agent_definitions
    (agent_code, version, input_schema_version, output_schema_version, prompt_version, role, definition_hash)
  values ('bad code', 'v1', 'in-v1', 'out-v1', 'p-v1', 'DOMAIN', repeat('e', 64))
$sql$, 'agent_code 형식 위반');

select fstest.expect_fail($sql$
  update private.agent_definitions set prompt_version = 'p-v2'
   where id = '00000000-0000-4000-8000-0000000000a0'
$sql$, 'Agent 정의 UPDATE');

insert into private.tool_definitions
  (id, tool_code, version, transport, input_schema_version, output_schema_version,
   max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
values ('00000000-0000-4000-8000-0000000000b0', 'law_search', 'v1', 'FUNCTION', 'in-v1', 'out-v1',
        65536, 10, 15000, 1, repeat('f', 64));

select fstest.expect_fail($sql$
  insert into private.tool_definitions
    (tool_code, version, transport, input_schema_version, output_schema_version,
     max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
  values ('slow_tool', 'v1', 'FUNCTION', 'in-v1', 'out-v1', 1024, 1, 181000, 0, repeat('0', 64))
$sql$, 'Run deadline 180초를 넘는 timeout');

select fstest.expect_fail($sql$
  insert into private.tool_definitions
    (tool_code, version, transport, input_schema_version, output_schema_version,
     max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
  values ('retry_tool', 'v1', 'FUNCTION', 'in-v1', 'out-v1', 1024, 1, 1000, 6, repeat('0', 64))
$sql$, 'retry_limit 상한 초과');

select fstest.expect_fail($sql$
  insert into private.tool_definitions
    (tool_code, version, transport, input_schema_version, output_schema_version,
     max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
  values ('big_tool', 'v1', 'FUNCTION', 'in-v1', 'out-v1', 10485761, 1, 1000, 0, repeat('0', 64))
$sql$, '입력 상한 10 MiB 초과');

select fstest.expect_fail($sql$
  insert into private.tool_definitions
    (tool_code, version, transport, input_schema_version, output_schema_version,
     max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
  values ('http_tool', 'v1', 'HTTP', 'in-v1', 'out-v1', 1024, 1, 1000, 0, repeat('0', 64))
$sql$, '열거하지 않은 transport');

select fstest.expect_fail($sql$
  delete from private.tool_definitions
   where id = '00000000-0000-4000-8000-0000000000b0'
$sql$, 'Tool 정의 DELETE');

\echo '14. agent_tool_allowlists'
select fstest.expect_ok($sql$
  insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
  values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000b0', 'LAW_LOOKUP')
$sql$, '등록된 Agent·Tool 허용 목록');

select fstest.expect_fail($sql$
  insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
  values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000b0', 'LAW_LOOKUP')
$sql$, '같은 Agent·Tool·목적 중복');

select fstest.expect_fail($sql$
  insert into private.agent_tool_allowlists (agent_definition_id, tool_definition_id, purpose_code)
  values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000ff', 'LAW_LOOKUP')
$sql$, '미등록 Tool 을 허용 목록에 추가');

select fstest.expect_fail($sql$
  delete from private.agent_tool_allowlists
   where agent_definition_id = '00000000-0000-4000-8000-0000000000a0'
$sql$, '허용 목록 DELETE');

-- Registry 행이 있는 동안 정의를 지울 수 없다. Trigger 가 먼저 막는다.
select fstest.expect_fail($sql$
  delete from private.agent_definitions
   where id = '00000000-0000-4000-8000-0000000000a0'
$sql$, '허용 목록이 참조하는 Agent 정의 DELETE');

\echo '15. Registry 권한'
do $$
declare n int;
begin
  set local role finshield_worker;
  -- 0021 이 제품 Agent 를 심으므로 총수는 고정값이 아니다. 이 시험이 만든 것만 센다.
  select count(*) into n from private.agent_definitions
   where id in ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a9');
  if n <> 2 then raise exception 'Worker 가 Agent 정의를 읽지 못했습니다 (%)', n; end if;
  select count(*) into n from private.agent_tool_allowlists
   where agent_definition_id in ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a9');
  if n <> 1 then raise exception 'Worker 가 허용 목록을 읽지 못했습니다 (%)', n; end if;
  raise notice '  허용 확인: Worker 가 Registry 를 읽는다';
  perform fstest.expect_fail($sql$
    insert into private.tool_definitions
      (tool_code, version, transport, input_schema_version, output_schema_version,
       max_payload_bytes, max_batch_size, timeout_ms, retry_limit, definition_hash)
    values ('worker_tool', 'v1', 'FUNCTION', 'in-v1', 'out-v1', 1024, 1, 1000, 0, repeat('1', 64))
  $sql$, 'Worker 가 Tool 정의 INSERT');
end
$$;

do $$
begin
  set local role authenticated;
  perform fstest.expect_fail($sql$ select count(*) from private.agent_definitions $sql$,
    '회원이 Agent 정의 조회');
  perform fstest.expect_fail($sql$ select count(*) from private.policy_versions $sql$,
    '회원이 정책 버전 조회');
end
$$;

do $$
begin
  set local role anon;
  perform fstest.expect_fail($sql$ select count(*) from private.tool_definitions $sql$,
    '익명이 Tool 정의 조회');
end
$$;

\echo '0006 불변식 시험을 통과했습니다.'
