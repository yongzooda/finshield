-- SEC-FILE-006: 화면을 떠난 입력의 만료 정리. 원격 Storage 없이 정확한 객체 범위·DB 부재를 검증한다.
\echo '파일 만료 정리 범위와 중복 처리'
begin;
do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; c uuid; other_case uuid;
 slot record; other_slot record; job record; state jsonb;
begin
 c:=private.create_case(owner,'LOAN','합성 만료 파일','expiry-case-a',repeat('e',64));
 other_case:=private.create_case(owner,'LOAN','합성 보존 파일','expiry-case-b',repeat('f',64));
 select * into strict slot from private.open_upload_slot(owner,c,'PDF','application/pdf',100,1,86400);
 select * into strict other_slot from private.open_upload_slot(owner,other_case,'PDF','application/pdf',100,1,86400);
 state:=private.file_expiry_context(slot.case_input_id);
 if not (state->>'pending')::boolean then raise exception '예약할 원본을 찾지 못함';end if;
 perform fstest.expect_fail(format('select private.expire_file_input(%L)',slot.case_input_id),'만료 전 삭제 방지');
 update private.input_objects set expires_at=now()-interval '1 second' where case_input_id=slot.case_input_id;
 perform private.expire_file_input(slot.case_input_id);
 perform private.expire_file_input(slot.case_input_id);
 if (select count(*) from private.file_cleanup_jobs where case_input_id=slot.case_input_id and reason_code='TTL_EXPIRED')<>1 then raise exception '중복 삭제 작업';end if;
 if exists(select 1 from private.file_cleanup_jobs where case_input_id=other_slot.case_input_id) then raise exception '다른 입력 삭제';end if;
 if not exists(select 1 from private.input_objects where case_input_id=slot.case_input_id and access_blocked_at is not null and slot_state='CLOSED') then raise exception '만료 접근 허용';end if;
 select * into strict job from private.claim_case_cleanup(owner,c);
 perform private.finish_file_cleanup_job(job.id,job.lease_token,null);
 state:=private.file_expiry_context(slot.case_input_id);
 if (state->>'pending')::boolean then raise exception '실제 부재 이후 미종결';end if;
 raise notice '  통과: 만료 전 보호·만료 접근 차단·한 입력만 중복 없이 정리·부재 확인';
end $$;
do $$ begin raise notice '22_file_expiry 시험을 모두 통과했습니다'; end $$;
rollback;
