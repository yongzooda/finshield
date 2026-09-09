# 인용 계약 실제 실행과 운영 반영

2026-09-09. 사용자가 제공한 합성 PDF와 정상 예방 Text를 실제 Sonnet 5·공식 출처·운영 DB에 연결했다. 성공한 반복만 고르는 Gate 평가가 아니며 이번 변경 후 각 시나리오 첫 실행이다.

| 표본 | 항목 수 | 검증·저장 응답 시간 | Run | Agent 및 Judge | 인용 오류 |
|---|---:|---:|---|---|---:|
| 합성 PDF | 6 | 92.981초 | COMPLETED | 7개 SUCCEEDED | 0 |
| 정상 예방 Text | 4 | 67.668초 | COMPLETED | 7개 SUCCEEDED | 0 |

PDF 업로드는 39,274바이트이며 전처리·추출은 13.596초였다. 표의 시간은 verify HTTP 응답까지로 업로드·전처리를 포함하지 않는다. PDF의 승인 항목은 NEED_MORE_INFORMATION, 금리·한도는 독립 확인 부족으로 UNKNOWN이다. 모든 사실 판정 성공 또는 B-CLAIM-01 통과라는 뜻이 아니다. 정상 Text의 예방 문구 두 건은 VERIFIED이고 위험 행동 라벨은 0개다.

- `pdf-first-live.json`, `normal-first-live.json`: API 실제 실행·저장 후 재조회. 모델 응답 원문이나 인증 값은 없다.
- `pdf-agent-ledger.json`, `completion-ledger.json`: SQL Editor에서 이번 소유자만 조회한 실행 기록. 2 Run·14 Agent 성공, PDF 원본 삭제 1건·잔존 0건이다.
- `final-budget.json`: Intake를 포함한 비용 USD 0.468376, 미정산 예약 0. 과거 다른 실행의 미확정 예약은 변경하지 않았다.
- `cli-candidate-*-rejected.json`: 첫 CLI 후보는 커밋 SHA가 비어 승격 검사가 거부했다. HTTP 200의 빌드 대기 페이지도 Runtime 성공으로 보지 않았다.
- `candidate-*`, `prepromotion-alignment.json`, `production-*`: Git 출처가 고정된 e9d6e9d 후보와 운영 주소의 Runtime·DB 대조. 구조 6종과 설정 10항목이 일치했다.
- `pdf-production*.png`, `passport-production.png`, `normal-production.png`와 UI 텍스트: 운영 사이트의 실제 합성 기록이다. 모바일 390px에서 가로 넘침은 없고 Console 오류도 없었다. 초기 로딩 캡처는 완료 뒤 다시 캡처했다. 정상 화면의 공통 설명 문장에는 ‘위험한 행동 요구’라는 말이 있지만 실제 위험 라벨은 0개임을 별도로 검사했다.
- `cleanup-api.txt`, `deletion-status-api.txt`, `deletion-ledger.json`: 재인증·반복 삭제 접수·Workflow COMPLETED·재로그인 401과 Auth/Profile/Case/원본/OCR/Embedding/Storage 부재. 시험 계정과 임시 자격 파일은 정리했다.
- `ui-local-required-293.txt`, `agent-local-required-295.txt`, `run-local-required.mjs`: 사용자가 승인한 로컬 필수 검사 실행이다. macOS Node 24.4.1에서 pr-check.yml의 각 단계를 실행했고 원격 Evidence 조회·한국어 검사·Preview 확인도 포함했다. GitHub-hosted CI 성공으로 표시하지 않는다. PR #295 병합 후보 f443c70과 배포 e9d6e9d의 코드 트리가 일치했다.

운영 주소는 `https://finshield-gamma.vercel.app`, 배포는 `dpl_EVipHpt7HpeJAtzTpjkFo2obb8zD`, 코드 SHA는 `e9d6e9d1c6d6ecd5c90bb4c6e27e089433885a04`다. main은 8f9b40a이며 PR #293·#295 병합은 Actions 한도 장애의 Required check 규칙 때문에 대기 중이다. 두 변경을 main에 통합하기 전 옛 main을 운영 재배포하면 이번 수정이 사라진다.

정식 Gate 채택은 하지 않는다. Implementation NO-GO·Release NOT-EVALUATED를 유지한다.
