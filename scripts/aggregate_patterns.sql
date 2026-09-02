-- risk_patterns 사전 집계 생성 (DR-105 · Q-4)
--
-- analyze_risk_pattern(F-505)은 이 표만 읽는다. 런타임 재계산·모델 추정 금지.
-- 모집단: 정식 조정결정서(source_type='DECISION') — 기획서 6.3 집계 정의와 동일 기준.
--
-- NULL 의미: "해당 차원 불문(전체)". 각 집계 단위는 포함 차원이 NOT NULL인
-- 행만 세므로(WHERE), 롤업 NULL과 데이터 NULL이 충돌하지 않는다.
--
-- 재적재 후에는 이 스크립트를 다시 실행한다 (delete 후 insert).
-- 실행: Supabase SQL Editor에 붙여넣고 Run

delete from risk_patterns;

with exploded as (
  select c.id, c.verdict, c.product_code, c.channel,
         ct.trait, ci.issue_tag_id
  from cases c
  left join case_traits ct on ct.case_id = c.id
  left join case_issues ci on ci.case_id = c.id
  where c.source_type = 'DECISION'
),
n_basis as (
  select 'DECISION_' || count(*) as basis
  from cases where source_type = 'DECISION'
),
agg as (
  -- ① 쟁점 단독
  select null::text as product_code, null::text as channel, null::text as trait,
         issue_tag_id,
         count(distinct id) as n_cases,
         count(distinct id) filter (where verdict = 'UPHELD')   as n_upheld,
         count(distinct id) filter (where verdict = 'REJECTED') as n_rejected
  from exploded where issue_tag_id is not null
  group by issue_tag_id

  union all
  -- ② 상품군 × 쟁점
  select product_code, null, null, issue_tag_id,
         count(distinct id),
         count(distinct id) filter (where verdict = 'UPHELD'),
         count(distinct id) filter (where verdict = 'REJECTED')
  from exploded where issue_tag_id is not null and product_code is not null
  group by product_code, issue_tag_id

  union all
  -- ③ 채널 × 쟁점
  select null, channel, null, issue_tag_id,
         count(distinct id),
         count(distinct id) filter (where verdict = 'UPHELD'),
         count(distinct id) filter (where verdict = 'REJECTED')
  from exploded where issue_tag_id is not null and channel is not null
  group by channel, issue_tag_id

  union all
  -- ④ 상품군 × 채널 × 쟁점
  select product_code, channel, null, issue_tag_id,
         count(distinct id),
         count(distinct id) filter (where verdict = 'UPHELD'),
         count(distinct id) filter (where verdict = 'REJECTED')
  from exploded
  where issue_tag_id is not null and product_code is not null and channel is not null
  group by product_code, channel, issue_tag_id

  union all
  -- ⑤ 상품군 × 특성 × 쟁점
  select product_code, null, trait, issue_tag_id,
         count(distinct id),
         count(distinct id) filter (where verdict = 'UPHELD'),
         count(distinct id) filter (where verdict = 'REJECTED')
  from exploded
  where issue_tag_id is not null and product_code is not null and trait is not null
  group by product_code, trait, issue_tag_id

  union all
  -- ⑥ 상품군 × 채널 × 특성 × 쟁점 (풀 조합)
  select product_code, channel, trait, issue_tag_id,
         count(distinct id),
         count(distinct id) filter (where verdict = 'UPHELD'),
         count(distinct id) filter (where verdict = 'REJECTED')
  from exploded
  where issue_tag_id is not null and product_code is not null
    and channel is not null and trait is not null
  group by product_code, channel, trait, issue_tag_id
)
insert into risk_patterns
  (product_code, channel, trait, issue_tag_id,
   n_cases, n_upheld, n_rejected, n_partial,
   stat_basis, batch_version, computed_at)
select a.product_code, a.channel, a.trait, a.issue_tag_id,
       a.n_cases, a.n_upheld, a.n_rejected, 0,
       (select basis from n_basis), 'v20260815', now()
from agg a
where a.n_cases > 0;

-- 확인
select
  (select count(*) from risk_patterns)                                    as rows_total,
  (select count(*) from risk_patterns
    where product_code is not null and channel is not null)               as combo_rows,
  (select stat_basis from risk_patterns limit 1)                          as basis;
