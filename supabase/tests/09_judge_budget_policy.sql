-- N-OPS-003·SEC-OPS-003: 심사 운영 상한·기존 원장·Fast 격리·권한을 검증한다.
begin;

do $$
declare
  v_before_reserved bigint;
  v_before_consumed bigint;
  v_failed boolean := false;
begin
  if (select count(*) from private.budget_limits
       where policy_version = 'judge-readiness-20260908-v1') <> 12 then
    raise exception '심사 예산 정책 12개 행이 고정되지 않았습니다';
  end if;

  if private.budget_limit_for('GLOBAL_DAY', 'all', '*') <> 20000000
     or private.budget_limit_for('OWNER_DAY', 'all', '*') <> 3000000
     or private.budget_limit_for('CASE', 'all', '*') <> 3000000
     or private.budget_limit_for('RUN', 'all', '*') <> 800000 then
    raise exception '전체 Provider 합산 상한이 다릅니다';
  end if;

  if private.budget_limit_for('RUN', 'anthropic', 'claude-sonnet-5') <> 800000
     or private.budget_limit_for('RUN', 'cohere', 'embed-v4.0') <> 100000 then
    raise exception 'Provider별 Run 상한이 다릅니다';
  end if;

  if exists (
    select 1 from private.budget_limits
     where provider = 'cohere' and model in ('*', 'rerank-v4.0-fast')
  ) then
    raise exception '개발 전용 Fast 또는 Cohere wildcard가 운영 정책에 포함됐습니다';
  end if;

  -- 현재 사용량을 초과한 낮은 Snapshot을 만들고 정책 재적용을 검증한다.
  insert into private.usage_budget_counters
    (scope_type, scope_key, provider, model, period_start, period_end,
     limit_microunits, reserved_microunits, consumed_microunits)
  values
    ('GLOBAL_DAY', 'judge-policy-probe', 'anthropic', 'claude-sonnet-5',
     date_trunc('day', now()), date_trunc('day', now()) + interval '1 day',
     10, 7, 5);
  select reserved_microunits, consumed_microunits
    into v_before_reserved, v_before_consumed
    from private.usage_budget_counters
   where scope_key = 'judge-policy-probe';

  update private.budget_limits
     set limit_microunits = 150000,
         policy_version = 'manual-higher-limit'
   where scope_type = 'RUN' and provider = 'cohere' and model = 'embed-v4.0';

  perform private.apply_judge_budget_policy();

  if (select limit_microunits from private.usage_budget_counters
       where scope_key = 'judge-policy-probe') <> 20000000 then
    raise exception '기존 활성 Counter의 상한이 증액되지 않았습니다';
  end if;
  if (select reserved_microunits <> v_before_reserved
             or consumed_microunits <> v_before_consumed
        from private.usage_budget_counters
       where scope_key = 'judge-policy-probe') then
    raise exception '정책 증액이 기존 예약 또는 사용량을 변경했습니다';
  end if;
  if private.budget_limit_for('RUN', 'cohere', 'embed-v4.0') <> 150000 then
    raise exception '더 높은 수동 상한을 낮췄습니다';
  end if;

  begin
    set local role finshield_worker;
    perform private.apply_judge_budget_policy();
  exception when insufficient_privilege then
    v_failed := true;
  end;
  reset role;
  if not v_failed then
    raise exception 'Worker가 예산 정책을 재적용했습니다';
  end if;

  raise notice '통과: 심사 상한·기존 원장 보존·Fast 격리·DB 소유자 전용 적용';
end
$$;

do $$ begin raise notice '10_judge_budget_policy 시험을 모두 통과했습니다'; end $$;
rollback;
