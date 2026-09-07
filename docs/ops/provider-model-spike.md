# B-MODEL-01 Provider Model Spike

이 문서는 `N-QLT-010`의 `B-MODEL-01`을 재현 가능한 GitHub Actions artifact로 측정하고 별도 PR에서 채택하는 절차다. run `33783765337`의 1차 합격은 검색 blocker 재정의로 ADR decision digest가 바뀌어 채택이 무효가 됐다. 같은 harness와 합격식으로 main `41e8a5f61e676844935880ab0b59ed5bd0a005c9`에서 다시 측정한 run `33883439885`을 PR #52로 채택했다. 그 뒤 `.env.example`을 FinShield 기준으로 다시 쓰면서 scope digest가 바뀌어 이 채택도 무효가 됐다. 무효가 된 결과 파일은 모두 이력으로 보존하고 같은 harness로 재측정한다. scope 파일이나 ADR 본문을 바꿀 때마다 같은 재측정이 필요하다. Harness가 구현됐거나 API key가 존재한다는 사실만으로 blocker를 `PASS`로 바꾸지 않는다.

## 측정 계약

- 모델은 `claude-sonnet-5`로 고정한다.
- `.github/fixtures/provider-model-v1.json`의 합성·마스킹 50건만 외부로 전송한다.
- 각 Fixture는 strict tool call과 Structured Output을 각각 실제 호출해 총 100개 Provider request를 만든다.
- 단일 request P95는 10초 이하여야 한다.
- Text 20건은 두 request 합계 P95 105초·비용 USD 0.50 이하, File-derived 20건은 P95 155초·비용 USD 0.80 이하여야 한다.
- 429·timeout·refusal·schema error는 각 5건의 deterministic adapter fixture로 검증한다. 실제 Provider 장애 관측으로 표현하지 않는다.
- request ID는 중복을 검사한 뒤 SHA-256 inventory hash만 저장한다. Prompt, 응답 전문, API key, 사용자 데이터는 로그와 artifact에 남기지 않는다.
- 비용은 2026-09-04 Sonnet 5 표준 단가 input USD 2/MTok, output USD 10/MTok로 계산한다.

## 실행 경계

1. Harness·Fixture·정책을 일반 PR에서 검토하고 squash merge한다.
2. GitHub `provider-spike` environment는 `main`만 허용하고 `ANTHROPIC_API_KEY`를 environment secret으로 보관한다.
3. `Provider Spike Evidence` workflow를 `main`의 `B-MODEL-01` 입력으로 dispatch한다.
4. 실패 시 `result.json`을 만들거나 업로드하지 않는다. 오류 로그에는 Fixture ID와 정규화된 오류 종류만 남긴다.
5. 성공 artifact의 run, job, workflow/harness Git Blob, archive/result digest와 27일 TTL을 확인한다.
6. 별도 Adoption PR은 sanitized result, evidence index, ADR의 `B-MODEL-01=PASS`, README와 HANDOFF만 변경한다.
7. Adoption PR required `check`와 merge 후 main 검증이 끝나야 부분 PASS가 유효하다.

이 증거는 외부 독립 attestation이 아니라 `repository-controlled evidence`다. `B-MODEL-01`의 부분 PASS는 나머지 Implementation blocker나 전체 Gate를 자동으로 통과시키지 않는다.

## 로컬 계약 테스트

실제 Provider를 호출하지 않고 Fixture 수, strict tool·Structured Output 검증, fault 분류, token 비용식과 fail-closed 동작을 검사한다.

```bash
node .github/scripts/test-provider-model-spike.mjs
```

## 2026-09-07 실행 의존성 재등록

격리 Parser와 요청 독립 Job 검증용 `@vercel/sandbox@3.2.1`·`workflow@4.8.5`를 설치한다. 간접 의존성의 알려진 취약점 수정을 위해 `@workflow/core`의 `nanoid@5.1.16`, 두 World 패키지의 `undici@7.29.0`을 override한다. 이 PR은 의존성과 검증 정책을 사전등록하며 제품 기능 연결은 별도 변경이다.

새 패키지 Git Blob을 `provider-evidence.mjs`와 mutation 시험의 신뢰 기준에 함께 등록한다. 기존 run `33956322908`의 측정 결과는 보존하지만 현재 evidence index에서 제거한다. 새 의존성이 설치된 main에서 동일한 50건·100회 및 fault 20건을 재측정하고 별도 Adoption PR에서 채택한다. 모델·단가·합격선·Fixture·harness·workflow·다른 blocker 정책은 바꾸지 않는다. 검사에서 과거 scope를 새 scope로 덮어쓰거나 STALE 증거를 PASS로 취급하지 않는다.
