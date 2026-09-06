-- ============================================================
-- 0002 공개 Demo Seed (명세 6.10, 요구사항 S-001·ROLE-001)
--
--   승인된 합성 입력 한 건이다. 실제 사용자의 문장이 아니고 실제 기관이 보낸
--   문자도 아니다. 사칭 문자에서 흔히 보이는 표현만 모아 새로 지었다. 링크
--   주소도 실제로 있는 곳이 아니다.
--
--   worker 역할은 이 표에 쓰지 못한다. Seed 는 사람이 승인해 넣는 자료이기
--   때문이다. 그래서 이 파일은 Supabase SQL 편집기에서 직접 실행한다.
--
--   두 번 실행해도 같은 판이 하나만 남는다.
-- ============================================================

begin;

insert into demo.seed_versions (seed_code, version, input_type, masked_input,
                                expected_claim_manifest, content_hash)
values ('sunshine-loan-15', 'v1', 'TEXT',
        '[정부지원] 서민금융진흥원 햇살론15 최종 승인 대상자로 선정되셨습니다.
연 3.2% 고정금리로 최대 2,000만원까지 당일 입금 가능합니다.
오늘 18시까지만 접수 가능하니 아래 링크로 신청서를 작성해 주세요.
http://hatsalon-15.kr-apply.com/form
상담사 직통으로 연락 주시면 한도를 더 올려 드릴 수 있습니다.',
        '{"schema_version": "demo-seed-v1", "claims": [{"claim_type": "PRODUCT_TERM", "statement_masked": "햇살론15를 연 3.2% 고정금리로 최대 2,000만원까지 받을 수 있다.", "materiality": "MATERIAL"}, {"claim_type": "INSTITUTION", "statement_masked": "이 안내는 서민금융진흥원이 보낸 것이다.", "materiality": "MATERIAL"}, {"claim_type": "CHANNEL", "statement_masked": "신청은 hatsalon-15.kr-apply.com 에서 하면 된다.", "materiality": "MATERIAL"}, {"claim_type": "ELIGIBILITY", "statement_masked": "이미 최종 승인 대상자로 선정되어 당일 입금이 가능하다.", "materiality": "MATERIAL"}, {"claim_type": "CONDUCT", "statement_masked": "상담사에게 직접 연락하면 한도를 더 올려 준다.", "materiality": "SUPPORTING"}]}'::jsonb,
        '9c18547595f34bf7b736fd21b1147c3d93f29079f557859b75347d2801c7a446')
on conflict (seed_code, version) do nothing;

-- 이 Seed 가 어떤 공식 Snapshot 을 딛고 만들어졌는지 남긴다. 없으면 건너뛴다.
insert into demo.seed_sources (seed_version_id, source_snapshot_id, purpose_code)
select s.id, k.id, 'PRODUCT_BASELINE'
  from demo.seed_versions s
  cross join lateral (
    select id from kb.source_snapshots
     where source_type = 'PRODUCT'
     order by retrieved_at desc limit 1) k
 where s.seed_code = 'sunshine-loan-15' and s.version = 'v1'
on conflict do nothing;

insert into demo.seed_sources (seed_version_id, source_snapshot_id, purpose_code)
select s.id, k.id, 'IMPERSONATION_BASELINE'
  from demo.seed_versions s
  cross join lateral (
    select id from kb.source_snapshots
     where source_type = 'GUIDE' and official_id = 'kinfa:declare-center'
     order by retrieved_at desc limit 1) k
 where s.seed_code = 'sunshine-loan-15' and s.version = 'v1'
on conflict do nothing;

commit;
