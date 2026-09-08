# 운영 DB와 배포 코드 일치 복구

2026-09-08, N-OPS-005·N-OPS-007·SEC-OPS-004의 운영 복구 기록이다. 정식 Evidence Adoption이나 전체 출시 판정은 아니다.

## 확인한 불일치와 복구

기준 코드는 main `202825b2a61f4532b002c103ea0b04b2740b4003`이며 Migration 0001~0050이다. 운영 주소는 복구 전 `ba42700c784b274a5ee46bb42e9a04f943125b5d`를 실행했다. 미병합 Draft의 0051~0053은 이번 적용 대상에 포함하지 않았다.

실제 FinShield 프로젝트 `exarejrwvjochjdminzo`에서 아래 세 차이를 확인했다.

| 대상 | 복구 전 | 조치 |
|---|---|---|
| Migration 0045 | 초기 검증 재시도 함수 없음 | 커밋된 함수 정의와 revoke/grant를 그대로 복구 |
| Migration 0050 | v7 Manifest와 연결 없음 | 커밋된 INSERT로 v7과 Agent 7개·Tool 목적 연결 19개 추가 |
| Migration 0046 | 예산 함수 주석 두 줄 누락 | 원본 정의를 복구. 예산 함수 실행·상한 변경·Counter 재설정 없음 |

Owner SQL 세션에서 사전조건(누락 상태·기존 함수 MD5)을 확인하고 lock timeout 5초, statement timeout 30초인 단일 트랜잭션으로 반영했다. 적용 직전 활성 Run 3건과 사용자 기록을 변경하지 않았다. 기존 Migration ledger가 없으므로 소급 ledger를 만들거나 전체 Migration을 재실행하지 않았다.

예산 함수의 MD5는 복구 전 `5410d9c0ac739902a469bd826c91e17b`, 원본 복구 뒤 `8e6e1e947b85acf50211c73f2ae11722`다. 두 정의의 차이는 주석뿐이었다. 초기 제약 비교의 표기 차이는 동일한 search_path로 재검사해 해소했으며 운영 제약을 변경하지 않았다.

## DB 대조와 배포

빈 격리 기준 DB에 50개 Migration을 적용하고 SQL 시험 36파일을 통과했다. 운영 worker 연결로 독립 재조회한 결과 표·제약·인덱스·함수·View·RLS 정책의 여섯 digest가 모두 일치했다. 표 83개에 RLS와 FORCE RLS가 적용됐고, anon 누출 0건, Worker의 회원 본문 13개 표 접근 거부를 확인했다.

추가 대조도 모두 일치했다: 열·기본값·타입, 트리거, Enum, anon/authenticated/worker 함수 실행 권한, v7 Manifest 본문, Agent 정의·연결, Tool 정의·목적 연결, Allowlist, 참조 KB Release, 참조 Policy 정의. KB 대조는 등록 설정의 일치이며 검색 Corpus 품질 통과를 뜻하지 않는다.

검증한 Production 후보 `dpl_BMk18tw5DovLzBtdedpqCMxMqsZo`를 운영 주소에 승격했다. 운영 `/api/runtime-manifest`에서 기준 main SHA, Node 24, Production, `icn1`을 직접 확인했다. 이전 배포 `dpl_7j2n8b4uS87KFbN5sH6GFoWTWReH`는 보존했다.

[복구 전 구조](../../evidence/development/deployment/2026-09-08-db-alignment/schema-before.json), [복구 후 구조](../../evidence/development/deployment/2026-09-08-db-alignment/schema-after.json), [운영 전체 대조](../../evidence/development/deployment/2026-09-08-db-alignment/production-preflight.json)에 실패와 성공을 함께 보존한다.

## 다음 승격 전 점검

`scripts/ops/verify-production-alignment.mjs`는 읽기 전용 운영 점검이다. 전용 worker의 실제 DSN만 읽고 비밀번호·본문·토큰을 출력하지 않는다. 필수 비교 누락, Schema나 설정 차이, 다른 배포 SHA·환경·region, 5분보다 오래된 Runtime 관측은 종료 코드 1로 거부한다.

1. 승격할 commit을 checkout하고 격리 기준 DB를 해당 Migration 전체로 새로 만든다. 운영 DB에 이 초기화 명령을 사용하지 않는다.
2. 후보 `/api/runtime-manifest` 응답을 파일로 저장한다. 보호 배포는 `vercel curl`을 쓴다.
3. 아래 점검을 실행한다. 통과 후 합성 회원 흐름을 확인하고 같은 후보를 승격한다.
4. 운영 주소의 Runtime 관측으로 다시 대조한다. 실패하면 원인을 고치거나 검증된 이전 배포로 되돌린다.

```sh
node scripts/ops/verify-production-alignment.mjs \
  --database-env-file /절대경로/운영-worker-환경파일 \
  --container finshield-f5b6-audit --database finshield_audit \
  --runtime-file /임시경로/runtime.json \
  --expected-sha 대상의40자리커밋SHA \
  --output /임시경로/alignment.json
```

이 명령은 배포를 자동 변경하지 않으며 Vercel Dashboard 수동 승격을 기술적으로 차단하지 않는다. CI는 점검기의 누락·불일치 거부 회귀 시험을 실행한다. 운영 DB 접속을 포함하는 실제 점검은 승격 담당자가 실행해야 한다. 정식 B-SUPABASE 증거는 기존 main 실행과 별도 Adoption PR 절차를 계속 따른다.

## 실제 회원 요청 검증

- 보호된 Production 후보에서 합성 회원가입·기록 조회 200, Text Claim 추출 200을 확인했다. 단일 Claim 검증은 47.647초에 `saved=true`, `partial=false`로 종결됐고 결과 재조회 200이었다. Claim 결론 `UNKNOWN`을 성공 판정으로 바꾸지 않았다. 여기서 전체 종결은 실행·저장 성공을 뜻한다.
- 운영 승격 뒤 후보에서 저장한 같은 Case를 운영 주소에서 조회해 200을 확인했다.
- 운영에서 `run_started` 직후 클라이언트 연결을 끊고 화면처럼 해당 이벤트의 최신 Claim과 Run ID로 재시도했다. 47.039초에 `saved=true`, `partial=false`로 종결됐다. 재조회에서 이전 Run `FAILED/CLIENT_RETRY`, 새 Run `COMPLETED`, Passport 1개·최종 Claim 1개를 확인했다.
- 첫 시험 도구는 확정 전 Revision 1을 다시 보내 `40001`로 거부됐다. 트랜잭션은 이전 Run을 잘못 종결하지 않았고, 기존 Run은 이후 완료됐다. 이미 완료된 Case의 초기 검증 반복도 `23514`로 거부됐다. 이 실패를 지우지 않고 [Live 시험 기록](../../evidence/development/deployment/2026-09-08-db-alignment/live-smoke.json)에 보존했다. 실제 화면은 `run_started`에서 최신 Claim으로 교체하므로 수정한 시험 도구도 동일하게 동작시켰다.
- 합성 계정의 세 Case는 계정 탈퇴 Workflow `COMPLETED` 뒤 재로그인 401로 정리를 확인했다. 시험 자격·Token·Cookie 임시 파일을 제거했다.
- 기본 시험 첫 실행은 CI 환경변수 일부를 빠뜨려 실패했다. 저장소 CI 환경 전체를 사용한 재실행은 643개 통과·선택적 96개 skip이다. TypeScript 통과, lint 오류 0·기존 경고 2다. skip을 Live 성공으로 세지 않는다.

전체 P0, OCR·Retrieval 품질, Workflow 장애 20종, 회원 Text·Image·PDF 전체 E2E는 이번 복구로 완료 처리하지 않는다. Implementation NO-GO, Release NOT-EVALUATED, 현재 부분 PASS 8/20을 유지한다.
