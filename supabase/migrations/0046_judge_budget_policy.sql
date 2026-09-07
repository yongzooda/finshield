-- N-OPS-003·SEC-OPS-003: 심사 기간의 정상 사용을 합성 개발 상한과 분리한다.
-- USD 1 = 1,000,000 microunits. 이 정책은 유료 플랜을 변경하지 않는다.
-- 이미 더 높은 수동 상한은 낮추지 않고, 미확정 예약·사용량은 초기화하지 않는다.

create or replace function private.apply_judge_budget_policy()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_policy constant text := 'judge-readiness-20260908-v1';
  v_limits_updated integer := 0;
  v_counters_updated integer := 0;
begin
  insert into private.budget_limits
    (scope_type, provider, model, limit_microunits, policy_version)
  values
    ('GLOBAL_DAY', 'all',       '*',                  20000000, v_policy),
    ('OWNER_DAY',  'all',       '*',                   3000000, v_policy),
    ('CASE',       'all',       '*',                   3000000, v_policy),
    ('RUN',        'all',       '*',                    800000, v_policy),
    ('GLOBAL_DAY', 'anthropic', 'claude-sonnet-5',    20000000, v_policy),
    ('OWNER_DAY',  'anthropic', 'claude-sonnet-5',     3000000, v_policy),
    ('CASE',       'anthropic', 'claude-sonnet-5',     3000000, v_policy),
    ('RUN',        'anthropic', 'claude-sonnet-5',      800000, v_policy),
    ('GLOBAL_DAY', 'cohere',    'embed-v4.0',           1000000, v_policy),
    ('OWNER_DAY',  'cohere',    'embed-v4.0',            250000, v_policy),
    ('CASE',       'cohere',    'embed-v4.0',            250000, v_policy),
    ('RUN',        'cohere',    'embed-v4.0',            100000, v_policy)
  on conflict (scope_type, provider, model) do update
    set limit_microunits = greatest(
          private.budget_limits.limit_microunits,
          excluded.limit_microunits
        ),
        policy_version = case
          when private.budget_limits.limit_microunits < excluded.limit_microunits
            then excluded.policy_version
          else private.budget_limits.policy_version
        end;
  get diagnostics v_limits_updated = row_count;

  -- Counter에는 생성 시점의 상한이 고정된다. 현재 유효한 일 범위와
  -- 영구 Case·Run 범위를 같이 올려야 기존 Case도 새 정책을 사용한다.
  with policy(scope_type, provider, model, limit_microunits) as (
    values
      ('GLOBAL_DAY', 'all',       '*',                20000000::bigint),
      ('OWNER_DAY',  'all',       '*',                 3000000::bigint),
      ('CASE',       'all',       '*',                 3000000::bigint),
      ('RUN',        'all',       '*',                  800000::bigint),
      ('GLOBAL_DAY', 'anthropic', 'claude-sonnet-5',  20000000::bigint),
      ('OWNER_DAY',  'anthropic', 'claude-sonnet-5',   3000000::bigint),
      ('CASE',       'anthropic', 'claude-sonnet-5',   3000000::bigint),
      ('RUN',        'anthropic', 'claude-sonnet-5',    800000::bigint),
      ('GLOBAL_DAY', 'cohere',    'embed-v4.0',         1000000::bigint),
      ('OWNER_DAY',  'cohere',    'embed-v4.0',          250000::bigint),
      ('CASE',       'cohere',    'embed-v4.0',          250000::bigint),
      ('RUN',        'cohere',    'embed-v4.0',          100000::bigint)
  )
  update private.usage_budget_counters c
     set limit_microunits = greatest(
           c.limit_microunits,
           p.limit_microunits,
           c.reserved_microunits + c.consumed_microunits
         )
    from policy p
   where c.scope_type = p.scope_type
     and c.provider = p.provider
     and c.model = p.model
     and c.period_end > now();
  get diagnostics v_counters_updated = row_count;

  return jsonb_build_object(
    'policy_version', v_policy,
    'limit_rows_seen', v_limits_updated,
    'active_counters_seen', v_counters_updated
  );
end
$$;

revoke all on function private.apply_judge_budget_policy()
  from public, anon, authenticated, service_role, finshield_worker;

select private.apply_judge_budget_policy();

comment on function private.apply_judge_budget_policy() is
  '심사 운영 예산을 증액하되 기존 상한·예약·사용량은 줄이거나 초기화하지 않는 DB 소유자 전용 정책';
