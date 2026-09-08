# OCR 저신뢰 핵심 필드 확인 경계

기준일: 2026-09-08  
관련 요구사항: `INP-006`, `INP-007`, `N-QLT-008`, `N-QLT-010`  
관련 이슈: #277

## 문제와 변경

main 진단 run `34198597628`에서 실패한 `refinance-scanned` 7쪽은 CLOVA가 URL의 `example`을 `exaimple`로 읽었고 URL 행 최소 `inferConfidence`는 0.591이었다. 정상 3쪽의 URL은 최소 0.989였다. 행 복원과 필드 추출기는 Provider 문자열을 그대로 보존했다.

이번 변경은 CLOVA의 단어 신뢰도와 좌표를 파싱하되, DB에는 인식 문자열을 Finding으로 복제하지 않고 마스킹한 페이지의 구간·좌표·필드 종류·천분율 신뢰도만 남긴다. URL·기관명·상품명·숫자 중 0.9 미만이며 실제 Claim 구간과 겹치는 필드는 사용자 원본 대조 대상으로 표시한다. 대조 확인이 없는 Claim은 화면에서 자동 선택하지 않고 `private.confirm_case_claims`와 `private.confirm_aftercare_document`도 `OCR_REVIEW_REQUIRED`로 거부한다.

## 확인한 범위

- 빈 격리 DB에 현재 브랜치의 Migration 51파일(`0001`~`0051`)과 SQL 시험 37파일을 순서대로 적용해 모든 불변식이 통과했다.
- 실제 격리 DB 통합 시험에서 0.591 URL은 `OCR_URL` 위치 Finding으로 저장됐고 Finding JSON에 URL 문자열이 없음을 확인했다.
- 같은 Claim은 `ocr_reviewed` 없이 거부됐고 `true`를 명시한 뒤 확정 Revision에 확인 사실이 남았다.
- 기본 시험 638개 통과, 선택적 Live 시험 96개 skip, TypeScript·lint 오류 0건, Production build 통과를 확인했다.

## 남은 채택 경계

이 기록은 제품의 실패 안전성 구현과 로컬 검증이다. 기존 OCR 실패 결과를 바꾸지 않았고 `B-OCR-01` PASS가 아니다. 기존에 측정하지 않은 시나리오 가족과 합격식을 먼저 고정한 뒤 main에서 한 번 정식 측정하고 원본 artifact를 별도 Adoption PR로 채택해야 한다. 실제 FinShield DB에도 `0050` 다음 `0051`을 적용하기 전에는 배포 기능으로 간주하지 않는다.
