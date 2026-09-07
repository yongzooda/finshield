-- 알림 생성 실패·Outbox 완료 실패·구형 Orphan·중복 요청을 실제 트랜잭션으로 검사한다.
begin;
create or replace function fstest.fail_notification_finish() returns trigger language plpgsql as $$
begin if new.deduplication_key='notify-atomic-failure' and new.status='DELIVERED' then raise exception 'INJECTED_AFTER_INSERT'; end if; return new; end $$;
create trigger fstest_notification_finish before update on private.outbox_events for each row execute function fstest.fail_notification_finish();
do $$
declare v_owner uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); cid uuid; r jsonb;
begin
  insert into auth.users(id) values(v_owner),(other);
  cid:=private.create_case(v_owner,'LOAN','합성 알림 복구','notification-case',repeat('a',64));
  insert into private.outbox_events(aggregate_type,aggregate_id,event_type,deduplication_key,payload,status,attempt_no,available_at)
    select 'EVIDENCE_PASSPORT',cid,'NOTIFICATION_REQUESTED',key,
      jsonb_build_object('schema_version','1','owner_id',v_owner,'case_id',cid,'notification_type',kind),state,attempt,now()-interval '10 minutes'
    from(values('notify-first','VERIFICATION_COMPLETED','PENDING',0),('notify-orphan','REVALIDATION_NO_CHANGE','PROCESSING',5),
      ('notify-atomic-failure','VERIFICATION_COMPLETED','PENDING',0),('notify-invalid','UNSUPPORTED_EVENT','PENDING',0)) x(key,kind,state,attempt);
  insert into private.outbox_events(aggregate_type,aggregate_id,event_type,deduplication_key,payload)
    values('CASE_INPUT',cid,'RAW_DELETE_REQUESTED','notification-other-type','{"schema_version":"1"}');
  r:=private.deliver_notification_batch(other,20);
  if (r->>'delivered')::integer<>0 then raise exception '다른 소유자 처리'; end if;
  r:=private.deliver_notification_batch(v_owner,20);
  if r<>jsonb_build_object('delivered',2,'failed',2) then raise exception '알림 처리 수 불일치 %',r; end if;
  if exists(select 1 from public.notifications where deduplication_key='notify-atomic-failure') then raise exception 'Outbox 실패 시 알림 부분 commit'; end if;
  if not exists(select 1 from private.outbox_events where deduplication_key='notify-atomic-failure' and status='FAILED' and attempt_no=1 and error_code='NOTIFY_FAILED') then raise exception '재시도 원장 누락'; end if;
  if not exists(select 1 from private.outbox_events where deduplication_key='notification-other-type' and status='PENDING') then raise exception '삭제 Outbox 오종결'; end if;
  if not exists(select 1 from public.notifications where deduplication_key='notify-first' and title='검증 결과가 저장되었습니다' and delivery_status='DELIVERED') then raise exception '초기 알림 문구 오류'; end if;
  if not exists(select 1 from public.notifications where deduplication_key='notify-orphan' and notification_type='REVALIDATION_NO_CHANGE' and title='다시 확인했으나 달라진 것이 없습니다') then raise exception '변화 없음 위험 알림 오분류'; end if;
  perform private.deliver_notification_batch(v_owner,20);
  if (select count(*) from public.notifications where owner_id=v_owner)<>2 then raise exception '중복 알림'; end if;
  -- 외부 INSERT만 성공하고 Outbox가 남은 과거 기록도 기존 알림 하나로 종결한다.
  update private.outbox_events set status='PROCESSING',delivered_at=null,available_at=now()-interval '10 minutes' where deduplication_key='notify-first';
  perform private.deliver_notification_batch(v_owner,20);
  if (select count(*) from public.notifications where owner_id=v_owner)<>2 then raise exception '이전 부분 저장 복구 중복'; end if;
  execute 'drop trigger fstest_notification_finish on private.outbox_events';
  update private.outbox_events set available_at=now() where deduplication_key='notify-atomic-failure';
  perform private.deliver_notification_batch(v_owner,20);
  if not exists(select 1 from public.notifications where deduplication_key='notify-atomic-failure') then raise exception '실패 뒤 재시도 누락'; end if;
  raise notice '통과: 알림·Outbox 원자성·Orphan·동일 요청·소유자·삭제 작업 분리·실패 재시도';
end $$;
do $$ begin raise notice '29_notification_delivery 시험을 모두 통과했습니다'; end $$;
rollback;
