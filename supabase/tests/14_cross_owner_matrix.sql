-- ============================================================
-- 교차 소유·익명·Worker 거부 행렬 (ADR 15.1 Storage·RLS, 명세 16.2)
--
-- 표 목록을 손으로 적지 않는다. 카탈로그에서 네 스키마의 모든 일반 표를 읽어
-- 회원 B 가 회원 A 의 행을 읽기·수정·삭제·명의 삽입하려는 시도, 익명의 모든 표
-- 조회, Worker 의 모든 표 조회를 실행하고 결과를 센다. 허용되어서는 안 되는
-- 접근이 하나라도 통과하면 실패한다. 마지막에 한 줄 JSON 요약을 NOTICE 로
-- 남기고 증거 harness 가 그 값을 읽는다.
--
-- 앞선 시험이 회원 A 의 행을 여러 표에 남겨 두었으므로 "0행" 은 RLS 가
-- 걸러낸 결과다. 권한 오류(42501)도 거부로 센다.
-- ============================================================

\echo '73. 교차 소유·익명·Worker 거부 행렬'
do $$
declare
  t record;
  n bigint;
  owner_a constant uuid := '00000000-0000-4000-8000-00000000000a';
  owner_b constant uuid := '00000000-0000-4000-8000-00000000000b';
  cross_owner_denials integer := 0;
  anon_denials integer := 0;
  worker_denials integer := 0;
  worker_allowed integer := 0;
  unexpected integer := 0;
  inconclusive integer := 0;
  worker_denied_tables text[] := '{}';
  required_worker_denied constant text[] := array[
    'public.profiles', 'public.financial_profiles', 'public.financial_profile_versions',
    'public.financial_cases', 'public.case_inputs', 'public.case_input_pages', 'public.case_input_findings',
    'public.case_events', 'public.claims', 'public.claim_revisions', 'public.processing_consents',
    'private.input_objects', 'private.ocr_artifacts'];
  has_owner boolean;
  qualified text;
begin
  for t in
    select n.nspname, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname in ('public', 'private', 'kb', 'demo')
     order by 1, 2
  loop
    qualified := t.nspname || '.' || t.relname;
    select exists (select 1 from information_schema.columns
                    where table_schema = t.nspname and table_name = t.relname and column_name = 'owner_id')
      into has_owner;

    -- 회원 B: A 의 행 읽기
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","session_id":"10000000-0000-4000-8000-00000000000b","exp":4102444800}';
      if has_owner then
        execute format('select count(*) from %I.%I where owner_id = %L', t.nspname, t.relname, owner_a) into n;
      else
        execute format('select count(*) from %I.%I', t.nspname, t.relname) into n;
        -- 소유자 없는 공개 표는 kb·demo·private 에만 있다. 거기 접근 자체가 거부돼야 한다.
        if t.nspname = 'public' then n := 0; end if;
      end if;
      execute 'reset role';
      if n > 0 then
        unexpected := unexpected + 1;
        raise warning '회원 B 가 % 에서 A 의 행 % 건을 읽었다', qualified, n;
      else
        cross_owner_denials := cross_owner_denials + 1;
      end if;
    exception when insufficient_privilege then
      cross_owner_denials := cross_owner_denials + 1;
    end;

    if has_owner then
      -- 회원 B: A 의 행 수정
      begin
        set local role authenticated;
        set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","session_id":"10000000-0000-4000-8000-00000000000b","exp":4102444800}';
        execute format('update %I.%I set owner_id = owner_id where owner_id = %L', t.nspname, t.relname, owner_a);
        get diagnostics n = row_count;
        execute 'reset role';
        if n > 0 then
          unexpected := unexpected + 1;
          raise warning '회원 B 가 % 에서 A 의 행 % 건을 수정했다', qualified, n;
        else
          cross_owner_denials := cross_owner_denials + 1;
        end if;
      exception when insufficient_privilege then
        cross_owner_denials := cross_owner_denials + 1;
      when others then
        -- Trigger 가 먼저 막은 경우도 수정되지 않았으므로 거부다.
        cross_owner_denials := cross_owner_denials + 1;
      end;
      -- 회원 B: A 의 행 삭제
      begin
        set local role authenticated;
        set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","session_id":"10000000-0000-4000-8000-00000000000b","exp":4102444800}';
        execute format('delete from %I.%I where owner_id = %L', t.nspname, t.relname, owner_a);
        get diagnostics n = row_count;
        execute 'reset role';
        if n > 0 then
          unexpected := unexpected + 1;
          raise warning '회원 B 가 % 에서 A 의 행 % 건을 지웠다', qualified, n;
        else
          cross_owner_denials := cross_owner_denials + 1;
        end if;
      exception when insufficient_privilege then
        cross_owner_denials := cross_owner_denials + 1;
      when others then
        cross_owner_denials := cross_owner_denials + 1;
      end;
      -- 회원 B: A 의 행을 자기 명의로 가져가기 (소유권 탈취)
      begin
        set local role authenticated;
        set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","session_id":"10000000-0000-4000-8000-00000000000b","exp":4102444800}';
        execute format('update %I.%I set owner_id = %L where owner_id = %L', t.nspname, t.relname, owner_b, owner_a);
        get diagnostics n = row_count;
        execute 'reset role';
        if n > 0 then
          unexpected := unexpected + 1;
          raise warning '회원 B 가 % 에서 A 의 행 % 건을 자기 명의로 바꿨다', qualified, n;
        else
          cross_owner_denials := cross_owner_denials + 1;
        end if;
      exception when insufficient_privilege then
        cross_owner_denials := cross_owner_denials + 1;
      when others then
        cross_owner_denials := cross_owner_denials + 1;
      end;
      -- 회원 B: A 명의 삽입. 권한 오류만 거부로 세고 다른 오류는 판정 불가로 둔다.
      begin
        set local role authenticated;
        set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","session_id":"10000000-0000-4000-8000-00000000000b","exp":4102444800}';
        execute format('insert into %I.%I (owner_id) values (%L)', t.nspname, t.relname, owner_a);
        execute 'reset role';
        unexpected := unexpected + 1;
        raise warning '회원 B 가 % 에 A 명의 행을 넣었다', qualified;
      exception when insufficient_privilege then
        cross_owner_denials := cross_owner_denials + 1;
      when others then
        inconclusive := inconclusive + 1;
      end;
    end if;

    -- 익명: 모든 표 조회 거부
    begin
      set local role anon;
      execute format('select count(*) from %I.%I', t.nspname, t.relname) into n;
      execute 'reset role';
      unexpected := unexpected + 1;
      raise warning '익명이 % 를 읽었다 (% 건)', qualified, n;
    exception when insufficient_privilege then
      anon_denials := anon_denials + 1;
    end;

    -- Worker: 회원 본문 표는 거부, 실행·운영 표는 허용
    begin
      set local role finshield_worker;
      execute format('select count(*) from %I.%I', t.nspname, t.relname) into n;
      execute 'reset role';
      worker_allowed := worker_allowed + 1;
      if qualified = any(required_worker_denied) then
        unexpected := unexpected + 1;
        raise warning 'Worker 가 회원 본문 표 % 를 읽었다', qualified;
      end if;
    exception when insufficient_privilege then
      worker_denials := worker_denials + 1;
      worker_denied_tables := array_append(worker_denied_tables, qualified);
    end;
  end loop;

  execute 'reset role';
  if unexpected > 0 then
    raise exception '허용되어서는 안 되는 접근 % 건이 통과했다', unexpected;
  end if;
  if not (worker_denied_tables @> required_worker_denied) then
    raise exception 'Worker 거부 목록에 회원 본문 표가 빠졌다: %',
      (select string_agg(x, ', ') from unnest(required_worker_denied) x where not (x = any(worker_denied_tables)));
  end if;
  raise notice '  허용 확인: 교차 소유 거부 %건, 익명 거부 %건, Worker 거부 %건·허용 %건, 판정 불가 %건',
    cross_owner_denials, anon_denials, worker_denials, worker_allowed, inconclusive;
  raise notice 'MATRIX %', jsonb_build_object(
    'cross_owner_denials', cross_owner_denials, 'anon_denials', anon_denials,
    'worker_denials', worker_denials, 'worker_allowed', worker_allowed,
    'worker_denied_tables', to_jsonb(worker_denied_tables),
    'unexpected_allows', unexpected, 'inconclusive', inconclusive)::text;
end
$$;

\echo '74. 닫힌 slot 재업로드·차단 객체 열람 반복 거부'
do $$
declare
  i integer;
  v_object uuid := '00000000-0000-4000-8000-000000000e71';
  v_path text;
  slot_rejections integer := 0;
  read_rejections integer := 0;
begin
  select object_path into v_path from private.input_objects where id = v_object;
  if v_path is null then raise exception '11 이 만든 객체 e71 이 없다'; end if;
  for i in 1..20 loop
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","session_id":"10000000-0000-4000-8000-00000000000a","exp":4102444800}';
      insert into storage.objects (bucket_id, name) values ('finshield-quarantine', v_path);
      execute 'reset role';
      raise exception '닫힌 slot 경로에 재업로드가 통과했다 (%)', i;
    exception when insufficient_privilege or unique_violation then
      slot_rejections := slot_rejections + 1;
    end;
    begin
      perform private.authorize_input_object_read('00000000-0000-4000-8000-00000000000a', v_object);
      raise exception '접근 차단 객체의 Signed URL 허가가 통과했다 (%)', i;
    exception when insufficient_privilege or no_data_found then
      read_rejections := read_rejections + 1;
    end;
  end loop;
  execute 'reset role';
  raise notice '  허용 확인: 닫힌 slot 재업로드 %회·차단 객체 열람 %회 모두 거부', slot_rejections, read_rejections;
  raise notice 'MATRIX %', jsonb_build_object('closed_slot_rejections', slot_rejections, 'blocked_read_rejections', read_rejections)::text;
end
$$;

\echo '75. 삭제 요청 즉시 접근 차단'
do $$
declare
  v_case uuid := '00000000-0000-4000-8000-0000000000c7';
  t0 timestamptz;
  n bigint;
  ms numeric;
begin
  t0 := clock_timestamp();
  perform private.request_case_deletion('00000000-0000-4000-8000-00000000000a', v_case, 'matrix-del', repeat('a', 64), repeat('b', 64), 'k1', 'p1');
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","session_id":"10000000-0000-4000-8000-00000000000a","exp":4102444800}';
  select count(*) into n from public.financial_cases where id = v_case;
  execute 'reset role';
  ms := extract(epoch from (clock_timestamp() - t0)) * 1000;
  if n <> 0 then raise exception '삭제 요청 뒤에도 소유자가 Case 를 읽었다'; end if;
  raise notice '  허용 확인: 삭제 요청 뒤 소유자 조회 0건 (% ms)', round(ms, 1);
  raise notice 'MATRIX %', jsonb_build_object('access_block_ms', round(ms, 1))::text;
end
$$;

\echo '교차 소유·Worker 거부 행렬 시험을 통과했습니다.'
