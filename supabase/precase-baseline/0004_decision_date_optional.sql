-- 의결일(decision_date) 조건부 필수 해제
--
-- 배경: 파일명에서 의결번호(제YYYY-N호)는 276건 추출되나 의결일은 원본 산출물
--       어디에도 없다 (meta에 연도·호수만 존재). 기존 decision_fields 제약이
--       DECISION 행에 의결일까지 요구해 적재가 전건 롤백됨.
--
-- 결정: 근거 인용의 최소 요건(Q-2)을 의결번호로 하고, 의결일은 NULL 허용.
--       의결일은 HWP 원문 표제부에서 추후 추출·보강한다 (보강 시 UPDATE만 하면 됨).
--       화면 표기는 의결일 확보 전까지 "제2022-7호(2022)" 형식(의결번호+연도)을 쓴다.

alter table cases drop constraint if exists decision_fields;
alter table cases add constraint decision_fields
  check (source_type <> 'DECISION' or decision_no is not null);

comment on column cases.decision_date is
  'NULL = 원본 산출물에 의결일 없음. HWP 표제부 추출로 추후 보강 가능. 표기는 의결번호+연도로 대체';
