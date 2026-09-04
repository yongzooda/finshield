-- 실물 코퍼스(360건)와 스키마 정합
--
-- 배경: data/corpus.json(240) + data/eval_set.json(120)을 열어보니 아래가 확인됨.
--   · sector 값이 5종 — 보험/증권/은행/카드/미상 (기존 CHECK는 4종)
--   · product_code 상당물 없음 → 모델 분류로 채우되, 분류 전/실패분은 NULL 허용
--   · source_url 없음 (금감원 게시물번호만 존재)
--   · case_year 135건 null (id에서 76건 복구, 59건은 원본에 정보 없음)
--   · verdict 실제 값은 인용/기각 2치 — PARTIAL 0건
--   · 주문유형 5종(인용 3종/기각/각하)이 label 2치로 눌려 있어 정보 손실 → 원본 보존
--
-- 정본: DB 명세서 + 데이터 요구사항. 본 마이그레이션 적용 후 두 문서를 갱신할 것.

-- ============================================================
-- 1. sector 확장 — CARD · UNKNOWN 추가
-- ============================================================
alter table cases drop constraint if exists cases_sector_check;
alter table cases add constraint cases_sector_check
  check (sector in ('INSURANCE','INVESTMENT','BANKING','CARD','UNKNOWN'));

alter table terms_clauses drop constraint if exists terms_clauses_sector_check;
alter table terms_clauses add constraint terms_clauses_sector_check
  check (sector in ('INSURANCE','INVESTMENT','BANKING','CARD','UNKNOWN'));

-- ============================================================
-- 2. 원본에 없는 필드 완화
--    NULL = "원본에 정보 없음". 값을 지어내지 않는다.
-- ============================================================
alter table cases alter column product_code drop not null;
alter table cases alter column source_url   drop not null;
alter table cases alter column case_year    drop not null;

-- ============================================================
-- 3. verdict 2치로 확정 (PARTIAL 실측 0건)
--    채점 매핑: 높음 ↔ UPHELD / 낮음 ↔ REJECTED
-- ============================================================
alter table cases drop constraint if exists cases_verdict_check;
alter table cases add constraint cases_verdict_check
  check (verdict in ('UPHELD','REJECTED'));

-- ============================================================
-- 4. 정보 보존 컬럼 신설
-- ============================================================

-- 주문유형 원본 — verdict 2치로 누르면서 잃는 정보
alter table cases add column if not exists order_type text
  check (order_type in ('UPHELD_AMOUNT','UPHELD_NO_AMOUNT','UPHELD_CONFIRM','REJECTED','DISMISSED'));

-- 출처 게시판 — 정식 결정서 / 위원회요약 / 민원사례집
alter table cases add column if not exists board text;

-- 금감원 게시물번호 (source_url 확정 시 URL 구성 근거)
alter table cases add column if not exists post_no text;

-- 라벨 출처 추적 — 어떤 필드가 원본이고 어떤 게 모델 분류인지 구분
--   ORIGINAL: 원본 데이터 그대로 · MODEL: 모델 분류 · RULE: 규칙 스크립트
alter table cases add column if not exists label_source text
  check (label_source in ('ORIGINAL','MODEL','RULE','MIXED'));

comment on column cases.product_code  is '모델 분류 결과. NULL = 분류 불가';
comment on column cases.source_url    is '원본 미보유. 금감원 URL 규칙 확정 시 post_no로 채울 것';
comment on column cases.case_year     is 'NULL 59건 — id·본문 어디에도 연도 없음';
comment on column cases.label_source  is '쟁점·상품군·채널·특성의 출처';

-- ============================================================
-- 5. 검증
-- ============================================================
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint where conrelid = 'cases'::regclass and contype = 'c';
