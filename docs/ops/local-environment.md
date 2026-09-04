# 로컬 환경변수 설정

## PreCase 자원 혼용 위험

2026-09-04 확인에서 `.env.example`이 PreCase 파일과 사실상 같았고 `LAW_API_OC`의 예시값이 `precase`였다. 이 예제를 그대로 따라 `.env.local`과 Vercel 환경변수를 채우면 FinShield가 PreCase 자원을 그대로 쓰게 된다.

같은 날 Production `/api/health`는 `db` 검사를 `ok`로 반환했다. FinShield 전용 Supabase 프로젝트가 아직 없으므로 이 연결 대상은 FinShield 전용 DB가 아니다. Runtime에는 `statute_cache`, `error_reports`, `usage_counters`, `api_budget` 네 곳에 쓰기가 있고 `/api/event`는 공개 엔드포인트다. 즉 읽기뿐 아니라 쓰기가 섞일 수 있다.

같은 응답에서 `law_api`는 `AUTH` 오류였다. 예시값 `precase`가 FinShield 배포에서 동작하지 않는다는 뜻이며, 등록 도메인 문제와 별개로 사용 승인 값이 아니다.

조치 순서는 다음과 같다.

1. FinShield 전용 Supabase 프로젝트를 만들고 최소 권한 Runtime 롤의 pooler DSN을 확보한다.
2. Vercel Production·Preview의 `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LAW_API_OC`를 FinShield 전용 값으로 교체하고 재배포한다.
3. 로컬 `.env.local`도 같은 기준으로 교체한다.
4. 교체 전까지 FinShield 배포로 트래픽을 유도하지 않는다.
5. PreCase DB에 FinShield 배포가 남긴 행이 있는지 별도로 확인한다. 확인과 정리는 PreCase 운영자 판단으로 수행하고 이 저장소에서 PreCase에 쓰기 작업을 하지 않는다.

## 현재 확인 결과와 영향

2026-09-04 확인 당시 사용자 기본 폴더와 두 Codex 작업 폴더에는 `.env.example`만 있었고 `.env`·`.env.local`은 없었다. 파일명·권한만 확인했으며 비밀값은 조회하지 않았다.

- 처음 로컬 `npm test`는 필수 환경변수 누락으로 실패했다. CI의 가짜 값과 `PRECASE_CI=1`로 다시 실행해 348개 통과·기존 외부 연동 72개 생략을 확인했다. 생략을 실제 연동 합격으로 계산하지 않는다.
- B-MODEL-01과 B-EMBED-01 실제 시험은 GitHub `provider-spike` Environment의 비밀값으로 실행했다. 로컬 파일이 필요하지 않다. 임베딩 품질 실패를 로컬 파일 부재 탓으로 해석하지 않는다.
- Production/Preview 빌드는 Vercel 환경변수를 사용했다. 로컬 파일과 자동 동기화되지 않는다.
- 로컬 앱의 실제 DB·외부 API 경로와 DB 의존 build는 현재 파일만으로 실행할 수 없다. 전용 FinShield DB·최소 권한·Source 자격 검증도 별도로 필요하다. 남은 Gate가 환경변수 파일 하나로 해제되는 것은 아니다.

## 파일 위치와 생성

사용자 기본 폴더에서는 `/Users/yongju/Developer/finshield/.env.local`을 사용한다. `src/` 안이나 `.env.local.txt`라는 이름으로 만들지 않는다.

```bash
cd /Users/yongju/Developer/finshield
cp -n .env.example .env.local
chmod 600 .env.local
open -e .env.local
```

`cp -n`은 기존 파일을 덮어쓰지 않는다. 위 명령은 사용자가 편집할 예제를 만드는 것이며 실제 키·DB를 발급하지 않는다. Finder에서는 Command+Shift+.로 숨김 파일을 표시할 수 있다. 작업 폴더들은 파일이 별개이므로 다른 worktree에 자동으로 생기지 않는다. 비밀값을 모든 worktree로 복제할 필요는 없다.

`KEY="값"` 형식으로 한 줄에 하나씩 적고 저장한다. 값 앞뒤 공백이나 실행 명령을 넣지 않는다. Next.js에서는 값 안의 달러 기호를 변수 참조로 해석할 수 있으므로 특수문자가 있는 키는 공식 규칙을 확인한다. DB 비밀번호는 제공된 연결 문자열의 URL 인코딩을 유지한다.

## 무엇을 입력하는가

| 변수 | 입력 원칙 |
|---|---|
| `DATABASE_URL` | 확인된 **FinShield 전용 개발 DB**의 최소 권한 Runtime 연결 문자열. 다른 프로젝트·PreCase·운영 DB 또는 관리자 계정으로 임시 대체하지 않는다. 현재 `SET_IN_VERCEL`은 사용 가능한 연결 문자열이 아니다. |
| `ANTHROPIC_API_KEY` | 로컬 외부 호출이 승인된 경우에만 별도 개발용 키. GitHub에 등록했다는 사실만으로 파일에 생기지 않는다. 키를 채팅·이슈·PR에 붙이지 않는다. |
| `ANTHROPIC_MODEL` | 예제 기본값을 ADR 4.1이 P0 기본 모델로 고정한 `claude-sonnet-5`로 맞췄다. `claude-opus-5`는 별도 평가를 통과한 고위험 재판정에만 허용하며 기본 경로와 자동 fallback에 쓰지 않는다. 모델을 바꾸면 `CONFIDENCE_THRESHOLD`를 재보정한다. 이 파일은 `B-MODEL-01` Evidence scope이므로 변경할 때마다 재측정이 필요하다. |
| `LAW_API_OC` | FinShield에서 사용할 본인의 승인된 법제처 OC. 예제에서 `precase`를 제거했다. Production에서 이 값이 `AUTH` 오류를 낸 것을 확인했다. |
| `LAW_API_BASE` | 예제의 공식 API 주소를 유지한다. OC·등록 도메인 검증을 대신하지 않는다. |
| `LAW_API_REGISTERED_ORIGIN` | 선택. 법제처 신청 시 등록한 도메인이다. Vercel 배포는 자기 도메인을 환경에서 받으므로 비워도 되고, 로컬 실행에는 필요하다. 다른 프로젝트 도메인을 넣지 않는다. 값이 없으면 호출이 실패한다. |
| `PUBLIC_MCP_ENABLED` | 반드시 `false`를 유지한다. |
| 상한·예산·세션 변수 | 예제의 모든 항목을 유지한다. 누락하면 환경 검증이 실패한다. |
| `BATCH_DATABASE_URL` | 일반 로컬 앱 실행에 불필요하며 비워 두는 것이 기본이다. 배치·Migration 권한이 별도 확인되기 전에는 실제 관리자 값을 넣거나 관련 스크립트를 실행하지 않는다. Vercel 환경변수에도 넣지 않는다. |
| `OPS_ALERT_WEBHOOK_URL` | 선택 항목. 사용하지 않으면 주석을 유지한다. |
| `COHERE_API_KEY` | 현재 main 전용 임베딩 시험은 GitHub `provider-spike`에만 필요하다. 로컬 앱용 예제에 없는 것이 이번 시험의 실패 원인이 아니다. |

전용 개발 DB 또는 OC가 없다면 해당 실제 연동은 미구성 상태로 둔다. 다른 프로젝트 비밀값을 복사하거나 가짜 값을 실제 자격증명처럼 쓰지 않는다. `NEXT_PUBLIC_` 접두사가 있는 변수에는 키·DB URL을 넣지 않는다.

## 실행·시험·Git 구분

- 필요한 전용 설정이 준비된 뒤 `npm run dev`를 실행한다. 변경한 값을 적용하려면 개발 서버를 재시작한다. 이는 NO-GO에서 허용되지 않은 제품 기능 구현·출시를 승인하는 절차가 아니다.
- 이 저장소의 Vitest는 `src/test/setup-env.ts`에서 `.env.local`을 직접 읽는다. 따라서 일반 Next.js의 test 환경 로딩 규칙과 다르다. DB 값이 있으면 일부 실제 DB 시험이 활성화될 수 있으므로 설정 직후 무작정 `npm test`·Migration·Seed를 실행하지 않는다.
- 순수 회귀 시험에는 CI에 정의된 가짜 값과 `PRECASE_CI=1`을 사용한다. `PRECASE_LIVE=1`은 설정하지 않는다. 실제 키가 없어도 평가 도구의 오프라인 계약 시험·린트·타입 검사는 진행할 수 있다.
- `.gitignore`는 `.env`·`.env.local`·`.env*.local`을 제외한다. 예제 파일에는 비밀값을 적지 않는다. 확인 명령은 `git check-ignore .env.local`이며 값은 출력하지 않는다.
- GitHub 비밀값은 등록 후 조회해서 내려받는 방식이 아니다. Vercel Production 값을 자동으로 로컬로 내려받지도 않는다. 각 실행 환경에 별도로 최소한만 등록한다.

공식 참고: [Next.js 환경변수](https://nextjs.org/docs/app/guides/environment-variables). 프로젝트 루트 로딩, 브라우저 노출 접두사, 달러 기호 처리, test 환경의 기본 차이를 확인한다. 실제 테스트의 추가 로더는 위 저장소 코드를 기준으로 한다.
