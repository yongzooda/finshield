# 심사 체험 세 결함의 개발 검증

상품 조건 근거, 검증 대기, 가입 후 점검을 다룬다. 단일 합성 개발 표본이며 전체 P0 품질·정식 Gate 합격을 뜻하지 않는다. 사전등록은 `docs/ops/review-evidence-latency.md`를 따른다.

## 거래 전 실제 Provider·파일·저장

같은 제공 PDF를 변경하지 않았다. 아래 시간은 추출 후 검증·저장 시간이며 파일 전처리·업로드는 별도다. 각 변경 후보의 첫 실행을 보존했다.

| 후보 | PDF 검증·저장 | 정상 Text 검증·저장 | 결과 |
|---|---:|---:|---|
| v13 | 76.392초 | 미실행 | PDF 전체 실행·저장, 시간 목표 미달 |
| v14 | 76.318초 | 62.544초 | PDF CoVe 잘림·CONFLICT DB 거부로 저장 실패, Text 성공·시간 미달 |
| v16 | 68.073초 | 51.634초 | 둘 다 저장·Agent 성공, PDF 시간 미달 |
| v17 | 70.792초 | 미실행 | PDF 성공·시간 미달, Text 전 후속 결정 |
| v18 | 57.733초 | 53.814초 | 둘 다 저장·Agent/Judge 14건 성공, 60초 개발 목표 충족 |

v18의 PDF 전처리는 24.832초, Text 추출은 9.150초다. PDF 6항목과 Text 4항목을 시험했고 현재 개인 승인·개별 기한을 확인한 결과가 아니다. 공식 상품 페이지의 종료 전 금리 15.9%·한도 2,000만 원과 보증 종료일을 맥락으로 제시한다. 일반 예방 지침으로 송신자·앱의 범죄 여부를 확정하지 않는다. 정상 예방 문구에 위험 행동 요구를 부여하지 않았다. v19의 변경은 가입 후 전용 경로이며 위 속도 측정의 SHA는 v18 `c645fc8`이다.

`final-run-ledger.json`은 두 Run COMPLETED·14 Agent/Judge SUCCEEDED·55개 정산 호출 USD 0.567248을 기록한다. 추출 비용은 이 수치에서 제외한다. worker가 private input 객체를 읽을 권한이 없어 files는 null이며 삭제 증거를 뜻하지 않는다.

## 실패 보존과 가입 후 수정

첫 표본은 Sales 출력 Claim 범위 오류로 PARTIAL이었다. v14의 두 번째는 두 Agent와 공식 조회 3건·저장·동일 요청 키·새 로그인 복원·기준 Passport 보존에 성공했다. v18 세 번째는 Regulation 모델 응답 뒤 저장 없이 FAILED였고, GET에 과거 assessment가 섞였다. 정확한 원문 실패 원인은 저장되지 않아 단정하지 않는다.

v19는 실제 계약 비교 항목에 집중하고 개인정보 의심 출력은 해당 finding만 안전하게 보류한다. 명시한 실패 Job에는 과거 assessment를 반환하지 않는다. 실제 실패 Job GET에서 assessment null을 확인했다. 최종 가입 후 완료·운영 반영·정리는 후속 증거를 따른다.

## 검사 범위

기본 테스트 702건 통과·선택적 96건 생략이며 Live 전체 시험으로 해석하지 않는다. Production build·타입·lint 오류 0(기존 경고 2건), 새 기준 DB의 62개 Migration과 실제 SQL 50파일을 검사한다. 마지막 SQL 번호는 52이며 파일 수와 다르다. RLS/FORCE RLS 누락·anon 잔여 권한은 0이다.

기존 fixture DB의 계정 삭제 Guard 실패와 로컬 필수 검사 중 임시 파일 정리 오류도 삭제하지 않았다. 전자는 별도 새 기준 DB, 후자는 자체 TMPDIR에서 재검증했다. 저장소 필수 검사는 실제 PR 병합 후보에서 실행하며 원격 Actions의 결제 장애를 성공으로 표시하지 않는다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다.

## 최종 후보와 운영 확인

v19 `f9031ca981af1230e0a0ebeaa3aee3f4dd786f69`의 가입 후 Job은 COMPLETED이고 두 Agent 모두 SUCCEEDED다. 공식 조회 3건과 정산 모델 응답 2건, 같은 요청 키의 동일 Job·새 로그인 복원·네 답변·금리 문구 비교·기준 Passport 불변을 확인했다. 실제 이전 실패 Job GET은 assessment null이다. `aftercare-final-*`와 `failed-job-restore-fixed.json`을 따른다.

실제 병합 후보 `2a266ae`의 필수 검사는 모두 로컬 통과했다. 후보 배포 `dpl_418rnextgdm4KLckt6XbfpM1f9rT`를 운영에 승격하고 공개 Runtime과 DB 정합성을 다시 확인했다. 운영 브라우저에서 결과·Passport·가입 후 점검·답변 편집 복원을 확인했다. 모바일 390px의 가로 넘침·내부 오류 코드 노출과 브라우저 오류는 0이다. 정상 Text에는 위험 행동 요구 배지가 없다. 화면·DOM·공개 Runtime 증거를 함께 보존한다.

이번 계정의 전체 모델 소비는 USD 2.315500이고 미정산 예약은 0이다. 실패한 첫 표본들까지 포함하며 기존 USD 3 사용자 상한을 변경하지 않았다. 다른 사용자의 예약은 건드리지 않았다.

시험 계정 탈퇴는 운영 API의 반복 요청 후 COMPLETED, 재로그인 401로 종결됐다. 같은 계정만 대상으로 실제 Supabase SQL Editor에서 Auth·Profile·Case·Input·활성 OCR·Embedding·Storage·활성 input object 잔여물 0건을 확인했다. API 응답과 물리 부재 확인을 구분해 보존한다.
