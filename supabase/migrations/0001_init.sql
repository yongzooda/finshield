-- 프리케이스(PreCase) 초기 스키마
-- 정본: DB 명세서 6장. 변경 시 문서를 함께 갱신할 것.
-- PostgreSQL 15+ 필요 (UNIQUE NULLS NOT DISTINCT)

create extension if not exists pg_trgm;

-- ============================================================
-- 룩업: 쟁점 태그 (U-9)
-- enum 타입이 아니라 룩업 테이블 — 값은 실물 라벨 적재로 확정한다.
-- scripts/load_corpus.py 가 구조화 산출물에서 추출해 채운다.
-- ============================================================
create table issue_tags (
  id          smallint generated always as identity primary key,
  code        text not null unique,
  label_ko    text not null,
  description text,
  active      boolean not null default true
);

-- ============================================================
-- DR-101 조정례 코퍼스 (360건)
-- ============================================================
create table cases (
  id                uuid primary key default gen_random_uuid(),
  source_type       text not null check (source_type in ('DECISION','SUMMARY')),
  decision_no       text,
  decision_date     date,
  sector            text not null check (sector in ('INSURANCE','INVESTMENT','BANKING','ETC')),
  product_code      text not null check (product_code in (
    'INS_SILSON','INS_WHOLE','INS_ANNUITY','INS_SAVINGS','INS_AUTO','INS_ETC',
    'INV_ELS','INV_FUND','INV_MARGIN','INV_ETC','BNK_LOAN','BNK_ETC','ETC_UNKNOWN')),
  -- NULL = 채널 미식별. UNKNOWN 값을 저장하지 않는다 (D-2)
  channel           text check (channel in ('TM','BANCA_HS','AGENT','BRANCH','ONLINE')),
  verdict           text not null check (verdict in ('UPHELD','REJECTED','PARTIAL')),
  compensation_rate smallint check (compensation_rate between 0 and 100),
  facts_summary     text not null,
  panel_reasoning   text,
  -- 원문 전문은 저장하지 않는다. 공식 페이지 링크만 (공공누리 재배포 범위)
  source_url        text not null,
  case_year         smallint not null check (case_year between 2007 and 2100),
  -- Q-1 누출 차단: 검증셋 120 : 검색 코퍼스 240
  is_validation     boolean not null default false,
  corpus_version    text not null,
  created_at        timestamptz not null default now(),
  -- Q-2: 정식 결정서는 의결번호·의결일 필수 (근거 인용 최소 요건)
  constraint decision_fields check (
    source_type <> 'DECISION' or (decision_no is not null and decision_date is not null))
);

create table case_issues (
  case_id      uuid not null references cases(id) on delete cascade,
  issue_tag_id smallint not null references issue_tags(id),
  primary key (case_id, issue_tag_id)
);

-- 행 부재 = 원문 미명시. NONE 을 저장하지 않는다
create table case_traits (
  case_id uuid not null references cases(id) on delete cascade,
  trait   text not null check (trait in ('PRO','ELDER','INEXP','CAPACITY')),
  primary key (case_id, trait)
);

-- ============================================================
-- DR-102 약관 조항 인덱스 (658건) — 표준약관 API 조회 불가의 대체
-- ============================================================
create table terms_clauses (
  id             bigint generated always as identity primary key,
  clause_text    text not null,
  sector         text check (sector in ('INSURANCE','INVESTMENT','BANKING','ETC')),
  product_code   text check (product_code in (
    'INS_SILSON','INS_WHOLE','INS_ANNUITY','INS_SAVINGS','INS_AUTO','INS_ETC',
    'INV_ELS','INV_FUND','INV_MARGIN','INV_ETC','BNK_LOAN','BNK_ETC','ETC_UNKNOWN')),
  source_case_id uuid references cases(id),
  corpus_version text not null
);

-- ============================================================
-- DR-103 용어 정의 조항 (153건) — F-104 풀이 원천
-- ============================================================
create table glossary_terms (
  id             bigint generated always as identity primary key,
  term           text not null,
  definition     text not null,
  source_case_id uuid references cases(id),
  corpus_version text not null,
  unique (term, definition)
);

-- ============================================================
-- DR-104 삭제 조문 스냅샷 (6건) — 불변 자산
-- 금소법 이관으로 삭제된 조문. 더 이상 개정되지 않으므로 갱신 절차 없음.
-- 대상: 자본시장법 46 / 46-2 / 47 / 49, 보험업법 95-2 이관 항 / 95-3
-- ============================================================
create table statute_snapshots (
  id           smallint generated always as identity primary key,
  law_name     text not null,
  article_no   text not null,
  article_text text not null,
  valid_from   date,
  valid_to     date,
  source_ref   text not null,   -- 국가법령정보센터 연혁법령 확보 경로
  captured_at  date not null,
  unique (law_name, article_no)
);

create table statute_timeline (
  id                smallint generated always as identity primary key,
  domain            text not null check (domain in ('SECURITIES','INSURANCE','COMMON')),
  law_name          text not null,
  article_no        text not null,
  applies_from      date,
  applies_to        date,
  successor_law     text,
  successor_article text,
  note              text
);

-- ============================================================
-- DR-105 분쟁 패턴 사전 집계 — analyze_risk_pattern 전용
-- 런타임 재계산·모델 추정 금지 (Q-4). 배치에서만 생성.
-- ============================================================
create table risk_patterns (
  id            bigint generated always as identity primary key,
  product_code  text check (product_code in (
    'INS_SILSON','INS_WHOLE','INS_ANNUITY','INS_SAVINGS','INS_AUTO','INS_ETC',
    'INV_ELS','INV_FUND','INV_MARGIN','INV_ETC','BNK_LOAN','BNK_ETC','ETC_UNKNOWN')),
  channel       text check (channel in ('TM','BANCA_HS','AGENT','BRANCH','ONLINE')),
  trait         text check (trait in ('PRO','ELDER','INEXP','CAPACITY')),
  issue_tag_id  smallint references issue_tags(id),
  n_cases       integer not null,
  n_upheld      integer not null default 0,
  n_rejected    integer not null default 0,
  n_partial     integer not null default 0,
  stat_basis    text not null default 'DECISION_235',
  batch_version text not null,
  computed_at   timestamptz not null,
  unique nulls not distinct (product_code, channel, trait, issue_tag_id, stat_basis)
);

-- ============================================================
-- DR-106 검증 통계 — 검증 결과 화면의 단일 출처 (Q-3)
-- 기획서 3.3 / 10.4 수치와 어긋나면 안 된다
-- ============================================================
create table validation_stats (
  id            smallint generated always as identity primary key,
  category      text not null check (category in
                ('HEADLINE','SECTOR','METHOD','UNVERIFIED','CORRECTION_POLICY')),
  metric_key    text not null unique,
  display_ko    text not null,
  value_json    jsonb not null,   -- {value, numerator, denominator, ci_low, ci_high, note}
  display_order smallint not null,
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- DR-201/202 캐시 — 만료 행을 삭제하지 않는다 (만료분 = 폴백 스냅샷)
-- ============================================================
create table statute_cache (
  law_name       text not null,
  article_no     text not null,
  basis_date     date not null,
  article_text   text not null,
  effective_date date,
  source         text not null check (source in ('API','SNAPSHOT')),
  fetched_at     timestamptz not null,
  expires_at     timestamptz not null,
  primary key (law_name, article_no, basis_date)
);

-- 정확 대조(F-502)는 캐시 적중과 무관하게 항상 수행할 것
create table precedent_cache (
  case_no    text primary key,
  body       text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null
);

-- ============================================================
-- DR-301 오류 신고 — 식별 컬럼 금지 (session_id · ip · user_agent 없음)
-- ============================================================
create table error_reports (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  masked_content  text not null,          -- F-601 마스킹 통과분만
  issue_code      text,                   -- 쟁점 분류(선택)
  channel         text check (channel in ('TM','BANCA_HS','AGENT','BRANCH','ONLINE')),
  status          text not null default 'RECEIVED'
                  check (status in ('RECEIVED','REVIEWING','CORRECTED','DISMISSED')),
  correction_note text,
  corrected_at    timestamptz
);

-- ============================================================
-- DR-302 익명 카운터 — 일 단위 집계 UPSERT만. 개별 이벤트 행 금지
-- ============================================================
create table usage_counters (
  event_type text not null check (event_type in
    ('JUDGMENT_DONE','WITHHELD','RECONSULT_ENTRY','REPORT_SUBMITTED','DEMO_VIEWED')),
  event_date date not null,
  cnt        integer not null default 0,
  primary key (event_type, event_date)
);

-- ============================================================
-- 뷰
-- ============================================================

-- Q-2: 검색은 cases 360건 전체, 근거 인용 표시는 이 뷰 소속만
create view citable_cases as
  select * from cases
  where source_type = 'DECISION' and decision_no is not null;

-- 검증 결과 화면의 정정 이력 공개 (masked_content 미포함)
create view public_corrections as
  select id, created_at::date as reported_on, correction_note, corrected_at
  from error_reports
  where status = 'CORRECTED';

-- ============================================================
-- 인덱스
-- ============================================================
create index idx_cases_validation on cases (is_validation);
create index idx_cases_filter     on cases (sector, product_code, channel, verdict);
create index idx_cases_year       on cases (case_year);
create index idx_cases_facts_trgm on cases using gin (facts_summary gin_trgm_ops);
create index idx_case_issues_tag  on case_issues (issue_tag_id, case_id);
