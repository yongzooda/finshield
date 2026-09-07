-- INP-013·SEC-PRI-010·CLM-006: 소유자, 처리 순서, 동의, 위치, 정확한 삭제 대상 검증.
\set ON_ERROR_STOP on
begin;
do $$
declare owner uuid:='00000000-0000-4000-8000-00000000000a'; other_owner uuid:='00000000-0000-4000-8000-00000000000b';
 kase uuid; inp uuid; obj uuid; page uuid; claim uuid; job record; ctx jsonb;
begin
 kase:=private.create_case(owner,'LOAN','합성 파일 원장','file-contract',repeat('d',64));
 select case_input_id into inp from private.open_upload_slot(owner,kase,'IMAGE','image/png',128,1,86400);
 ctx:=private.file_input_context(owner,kase,inp);obj:=(ctx->>'object_id')::uuid;
 begin perform private.file_input_context(other_owner,kase,inp);raise exception '교차 소유 파일 읽기 허용';
 exception when insufficient_privilege then null;end;
 perform private.record_file_ocr_consent(owner,kase,inp,true);
 if private.authorize_file_ocr(owner,kase,inp) then raise exception '검사 전 원본 전송 허용';end if;
 perform private.confirm_upload_slot(obj,'89504e47');
 perform private.advance_input_stage(owner,kase,inp,'VALIDATED','{"detected_mime":"image/png","magic_signature":"89504e47"}');
 if not private.authorize_file_ocr(owner,kase,inp) then raise exception '정상 동의 전송 거부';end if;
 if private.authorize_file_ocr(other_owner,kase,inp) then raise exception '다른 사람 동의 재사용 허용';end if;
 begin perform private.file_input_context(owner,kase,inp);raise exception '중복 처리 허용';
 exception when insufficient_privilege then null;end;
 perform private.register_input_pages(owner,kase,inp,1);
 select id into page from private.input_page_ids(owner,kase,inp);
 perform private.advance_input_stage(owner,kase,inp,'EXTRACTED','{}');
 perform private.advance_input_stage(owner,kase,inp,'MASKED','{"masked_text":"연 3% 금리","masked_text_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pii_policy_version":"pii-policy-v1"}');
 claim:=private.record_file_claim(owner,kase,inp,page,'PRODUCT_TERM','연 3% 금리','MATERIAL',
 '{"schema_version":"v1","kind":"masked_text_span","page_no":1,"start":0,"end":8}');
 if (select source_page_id from public.claims where id=claim)<>page then raise exception '페이지 연결 유실';end if;
 begin perform private.record_file_claim(owner,kase,inp,page,'PRODUCT_TERM','연 3% 금리','MATERIAL',
 '{"schema_version":"v1","kind":"masked_text_span","page_no":2,"start":0,"end":8}');raise exception '잘못된 페이지 위치 허용';
 exception when check_violation then null;end;
 perform private.stop_case_input(owner,kase,inp,'USER_STOPPED');
 if private.authorize_file_ocr(owner,kase,inp) then raise exception '중단한 원본 전송 허용';end if;
 if exists(select 1 from private.claim_case_cleanup(other_owner,kase)) then raise exception '타인 삭제 임대 허용';end if;
 for job in select * from private.claim_case_cleanup(owner,kase) loop
  ctx:=private.cleanup_object_context(job.id,job.lease_token);
  if ctx->>'path' not like owner::text||'/'||kase::text||'/'||inp::text||'/%' then raise exception '삭제 대상 경로 불일치';end if;
  perform private.finish_file_cleanup_job(job.id,job.lease_token,null);
  begin perform private.cleanup_object_context(job.id,job.lease_token);raise exception '완료된 삭제 임대 재사용';
  exception when lock_not_available then null;end;
 end loop;
 raise notice '파일 입력: 교차 소유·중복·검사 전/중단 후 OCR 거부, 페이지 위치·삭제 임대 검증 통과';
end $$;
do $$ begin raise notice '20_file_processing 시험을 모두 통과했습니다'; end $$;
rollback;
