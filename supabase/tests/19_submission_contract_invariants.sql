-- CLM-003·SEC-PRI-010: 편집 원장, 선택 제거, 고정된 검증 입력의 실제 DB 계약.
\set ON_ERROR_STOP on
begin;
do $$
declare owner uuid := '00000000-0000-4000-8000-00000000000a';
  other_owner uuid := '00000000-0000-4000-8000-00000000000b';
  man uuid := '00000000-0000-4000-8000-00000000aa01';
  kase uuid; inp uuid; cl uuid; excluded uuid; run uuid; payload jsonb; data jsonb;
begin
  kase := private.create_case(owner,'LOAN','제출 흐름 합성 시험','submission-case',repeat('a',64));
  inp := private.create_text_input(owner,kase,100,86400);
  perform private.advance_input_stage(owner,kase,inp,'VALIDATED','{}');
  perform private.advance_input_stage(owner,kase,inp,'EXTRACTED','{}');
  perform private.advance_input_stage(owner,kase,inp,'MASKED',jsonb_build_object(
    'masked_text','연 3% 고정금리','masked_text_hash',repeat('b',64),'pii_policy_version','pii-policy-v1'));
  cl := private.record_extracted_claim(owner,kase,inp,null,'PRODUCT_TERM','연 8% 고정금리','MATERIAL','MODEL');
  excluded := private.record_extracted_claim(owner,kase,inp,null,'OTHER','오늘 접수','NON_MATERIAL','MODEL');
  payload := jsonb_build_array(jsonb_build_object('claim_id',cl,'statement_masked','연 3% 고정금리','expected_revision_no',1));
  begin
    perform private.confirm_case_claims(other_owner,kase,payload);
    raise exception '타인의 Case를 수정했다';
  exception when insufficient_privilege then null; end;
  begin
    perform private.confirm_case_claims(owner,kase,payload||payload);
    raise exception '중복 Claim을 허용했다';
  exception when insufficient_privilege then null; end;
  perform private.confirm_case_claims(owner,kase,payload);
  if (select statement_masked from public.claim_revisions where claim_id=cl and revision_no=1) <> '연 8% 고정금리'
    or (select statement_masked from public.claim_revisions where claim_id=cl and revision_no=2) <> '연 3% 고정금리'
    or not (select is_removed from public.claim_revisions where claim_id=excluded order by revision_no desc limit 1) then
    raise exception '이전 판 보존·수정 판 추가·미선택 제거 실패';
  end if;
  begin
    perform private.confirm_case_claims(owner,kase,payload);
    raise exception '오래된 수정 판을 허용했다';
  exception when serialization_failure then null; end;
  perform private.transition_financial_case(owner,kase,'INPUT_REVIEW','USER','CLAIMS_CONFIRMED');
  run := private.create_verification_run(owner,kase,man,'submission-run',repeat('c',64),'INITIAL',null);
  data := private.read_run_input(owner,kase,run);
  if jsonb_array_length(data->'claims')<>1 or data->'claims'->0->>'statement_masked'<>'연 3% 고정금리' then
    raise exception '실행에 고정된 선택 문장을 읽지 못했다';
  end if;
  if private.read_run_input(other_owner,kase,run) is not null then
    raise exception '타인 실행 본문을 읽었다';
  end if;
  begin
    perform private.confirm_case_claims(owner,kase,payload);
    raise exception '검증 중인 문장을 수정했다';
  exception when check_violation then null; end;
  raise notice '제출 흐름 원장: 교차 소유·중복·오래된 판·실행 중 수정 거부, 이전 판 보존·고정 입력 통과';
end $$;
rollback;
