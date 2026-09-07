-- REV-005·REV-006·N-AVL-005·EC-020: 알림과 Outbox를 같은 트랜잭션에서 종결한다.
begin;
create or replace function private.deliver_notification_batch(p_owner uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.outbox_events%rowtype; v_owner uuid; v_case uuid; v_type text;
  v_title text; v_body text; made integer:=0; failed integer:=0;
begin
  if p_limit not between 1 and 200 then raise exception 'INVALID_NOTIFICATION_BATCH' using errcode='23514'; end if;
  for e in select * from private.outbox_events x
    where x.event_type='NOTIFICATION_REQUESTED'
      and (p_owner is null or x.payload->>'owner_id'=p_owner::text)
      and ((x.status in ('PENDING','FAILED') and x.available_at<=now() and x.attempt_no<x.max_attempts)
        or (x.status='PROCESSING' and x.available_at<=now()-interval '5 minutes'))
    order by x.available_at,x.created_at limit p_limit for update skip locked
  loop
    -- 이전 외부 Dispatcher가 마지막 시도에 멈췄어도 그 시도를 원자적으로 종결할 수 있다.
    update private.outbox_events set attempt_no=least(attempt_no+1,max_attempts) where id=e.id;
    begin
      v_owner:=(e.payload->>'owner_id')::uuid; v_case:=(e.payload->>'case_id')::uuid;
      v_type:=e.payload->>'notification_type';
      if v_owner is null or v_case is null then raise exception 'NOTIFICATION_CONTEXT_INVALID'; end if;
      if not exists(select 1 from public.financial_cases c where c.id=v_case and c.owner_id=v_owner and c.deleted_at is null)
        or exists(select 1 from public.deletion_requests d where d.owner_id=v_owner and d.target_type='ACCOUNT' and d.status<>'COMPLETED') then
        update private.outbox_events set status='DELIVERED',delivered_at=now(),error_code='CASE_UNAVAILABLE' where id=e.id;
        continue;
      end if;
      case v_type
        when 'VERIFICATION_COMPLETED' then v_title:='검증 결과가 저장되었습니다'; v_body:='판단과 확인 범위를 검증 기록에서 확인하세요.';
        when 'MATERIAL_CHANGE_DETECTED' then v_title:='다시 확인했더니 달라진 것이 있습니다'; v_body:='지난 판과 견주어 결과가 달라졌습니다. 무엇이 달라졌는지 기록에서 확인하세요.';
        when 'REVALIDATION_NO_CHANGE' then v_title:='다시 확인했으나 달라진 것이 없습니다'; v_body:='확인한 범위에서 중요한 변화가 없었습니다. 이전 기록과 새 기록을 함께 확인하세요.';
        else raise exception 'NOTIFICATION_TYPE_UNSUPPORTED';
      end case;
      insert into public.notifications(owner_id,case_id,notification_type,revalidation_job_id,passport_diff_id,passport_id,deduplication_key,title,body_masked,delivery_status)
        values(v_owner,v_case,v_type,(e.payload->>'revalidation_job_id')::uuid,(e.payload->>'passport_diff_id')::uuid,(e.payload->>'passport_id')::uuid,e.deduplication_key,v_title,v_body,'DELIVERED')
        on conflict(owner_id,channel,deduplication_key) do update set delivery_status='DELIVERED';
      update private.outbox_events set status='DELIVERED',delivered_at=now(),error_code=null where id=e.id;
      made:=made+1;
    exception when others then
      -- 원문/PII가 섞인 SQL 오류를 원장이나 앱 로그에 복제하지 않는다.
      update private.outbox_events set status='FAILED',error_code='NOTIFY_FAILED',
        available_at=now()+make_interval(mins=>power(2,least(attempt_no,10))::integer) where id=e.id;
      failed:=failed+1;
    end;
  end loop;
  return jsonb_build_object('delivered',made,'failed',failed);
end $$;
revoke all on function private.deliver_notification_batch(uuid,integer) from public,anon,authenticated;
grant execute on function private.deliver_notification_batch(uuid,integer) to finshield_worker;
commit;
