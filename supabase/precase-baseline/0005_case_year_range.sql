-- 사건 연도 범위 확장 (2007~ → 2003~)
--
-- 배경: 문서·초기 제약의 "2007~2026"은 corpus/eval의 raw year 필드 기준이었다.
--       year가 null인 135건 중 76건을 파일명에서 복구했더니 2003~2006년이 29건 —
--       요약 사례집이 2003년부터 존재한다 (예: 64072_2005-66.hwp).
--       실측 범위: 2003 ~ 2026.
--
-- 후속: 데이터 요구사항 "사건 연도 범위" 서술을 2003~2026으로 갱신할 것.

alter table cases drop constraint if exists cases_case_year_check;
alter table cases add constraint cases_case_year_check
  check (case_year between 2000 and 2100);
