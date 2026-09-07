# N-AVL-001 저비용 Health 인프라

`/api/health`는 앱의 응답과 FinShield 핵심 DB의 `select 1`만 확인한다. 요청에서 Anthropic 모델 목록·법령·OCR·Embedding API나 기존 예산 원장을 조회하지 않는다. DB 조회는 1.5초에 중단하고, 실패·설정 누락·시간 초과는 기본/엄격 모드 모두 HTTP 503이다. 오류 메시지·DSN·키·사용자 본문은 응답에 포함하지 않는다.

외부 Provider 상태는 실제 호출자가 `providerStatusCache.observe`에 남긴 성공/실패를 읽는다. 5분이 지나거나 아직 관측이 없으면 `unknown`이며 Health 조회가 관측 시각을 갱신하지 않는다. 현재 main에는 실제 호출 결과를 이 Cache에 연결하는 기능이 없으므로 외부 상태는 기본적으로 `unobserved`다. Cold start·다른 인스턴스의 미관측을 정상으로 만들지 않는다. 이 메모리 Cache는 durable 운영 상태 원장을 대신하지 않는다.

핵심 DB가 정상이고 외부 상태가 불명확하면 기본 응답은 `degraded`·200이다. `?strict=1`은 기존 감시자의 선택을 유지해 이 경우 503으로 응답한다. 모든 최근 관측과 DB가 정상이면 `ok`다.

`node .github/scripts/test-health-status.mjs`는 100회 호출의 외부 fetch 0회, Cache 만료·시계 역행·DB 오류·중단·HTTP 상태를 확인한다. 이는 격리 계약 시험이며 실제 배포 100회·Provider trace·main artifact 채택을 대신하지 않는다. B-HEALTH-01과 전체 Implementation·Release Gate를 변경하지 않는다.


## 실제 HTTP 측정과 채택 절차

`Health Evidence`는 immutable main을 새 디렉터리에 checkout하고 Provider 키 없이 Next를 빌드한다. 실행 단계에서만 FinShield worker DB 설정을 전달한다. 같은 빌드의 실제 `/api/health`를 100회 호출한 뒤, 별도 인스턴스의 끊긴 격리 DB로 기본·엄격 오류 응답을 검증한다. 공개 장애 주입 옵션은 만들지 않는다.

시험 서버의 preload는 fetch·Node HTTP·HTTPS 전송 시도를 전부 차단하고 횟수만 기록한다. 별도 제어 프로세스가 세 경로를 각각 한 번 호출해 계측 누락을 확인한다. 정상·DB 장애 서버에서는 모두 0이어야 한다. 원본 URL·본문·DSN을 전송 원장에 남기지 않는다. 실제 Provider API나 청구 API를 호출할 필요가 없는 시험이다.

공통 Health 구현의 미관측·성공·만료·실패·시계 역행 Cache 상태를 별도로 측정한다. 이 시험은 소유권·Provider 품질·장애 복구 전체를 증명하지 않는다. Preview/Production의 실제 Node·region·deployment 관측은 별도 B-RUNTIME-01 증거를 따른다.

결과는 고정 scope digest·Workflow/Harness/Policy/계측기/Core SHA pin·main 실행·원본 artifact·별도 Adoption PR을 모두 통과해야 B-HEALTH-01에 채택한다. 계약 시험은 잘못된 HTTP, 표본 누락, 계측기 미실행, 외부 전송, 미관측 정상 표시 등 25개 변조를 거부한다. 저장소 밖의 독립 보증으로 표현하지 않는다.
