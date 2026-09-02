-- ============================================================
-- 0006 — Claude API 예산 계량 (N-204 · D-4)
--
-- 왜 DB인가: 하드 쿼터는 **전역**이어야 한다. Vercel은 라우트마다 별도 함수로
-- 배포되고 인스턴스도 여러 개라, 프로세스 메모리로 세면 각자 다른 숫자를 본다
-- (세션에서 이미 겪었다 — 마이그레이션 없이 봉인 토큰으로 우회했지만, 쿼터는
-- 이용자가 들고 다닐 수 없는 값이라 공유 저장소가 필요하다).
--
-- 저장 금지(DR-4xx)와의 관계: 여기 쌓이는 것은 **날짜별 토큰 합계**뿐이다.
-- 진술·슬롯·판단·실행 로그가 아니고, 개별 호출 행을 남기지 않으므로 시각
-- 상관관계로 세션을 재구성할 수도 없다. `usage_counters`(DR-302)와 같은 성격이다.
-- ============================================================

create table api_budget (
  usage_date    date primary key,
  input_tokens  bigint  not null default 0,
  output_tokens bigint  not null default 0,
  calls         integer not null default 0,
  updated_at    timestamptz not null default now()
);

alter table api_budget enable row level security;

-- 런타임은 읽고 더할 수 있어야 한다 (증가만 — 삭제 권한은 주지 않는다)
create policy runtime_all_budget on api_budget
  for all to app_runtime using (true) with check (true);

grant select, insert, update on api_budget to app_runtime;

-- 검증 (아래가 실패해야 정상)
--   set role app_runtime;
--     delete from api_budget;   -- ❌ permission denied 여야 함
--   reset role;
