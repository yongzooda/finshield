# B-CI-INTEGRITY Preflight

이 문서는 `N-QLT-010`의 `B-CI-INTEGRITY`를 닫기 전에 필요한 GitHub 외부 통제 준비 상태를 기록한다. 이 문서와 저장소 내부 스크립트의 성공은 blocker `PASS`가 아니다.

## 2026-09-04 관측

| 항목 | 관측값 | 판정 |
|---|---|---|
| 저장소 | private `yongzooda/finshield` | 관측 |
| 소유자 | 개인 계정 `User` | 차단 |
| main Ruleset | repository-level `Protect main`, active, bypass actor 0명 | 부분 충족 |
| required check | GitHub Actions `check` | 부분 충족 |
| strict required status | `true`로 강화 | 충족 |
| Actions 기본 token | read-only, PR 승인 불가 | 충족 |
| Actions artifact/log retention | 90일 | 30일 기준 충족 |
| organization Required Workflow | 없음 | 차단 |
| 외부 App attestation consumer | 없음 | 차단 |

개인 소유 저장소의 자체 workflow와 validator는 PR이 같은 경로를 바꾸거나 같은 이름의 check를 만들 수 있어 신뢰 루트가 될 수 없다. GitHub의 required status check는 workflow·event trigger를 구분하지 않으므로 `check` 이름만 필수로 두는 현재 구조도 충분하지 않다.

Sanitized 관측 결과는 `evidence/ci-integrity/preflight-2026-09-04.json`에 보존한다. GitHub 공식 문서상 required workflow ruleset은 Organization 또는 Enterprise 수준에서 구성하며, required status check는 workflow나 event trigger를 식별하지 않는다.

- [Ruleset에서 workflow를 필수로 지정하는 규칙](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging)
- [Required status check 식별 제한](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules#troubleshooting-required-status-checks)

## 권장 해제 경로

1. FinShield 전용 GitHub Organization을 GitHub Team 이상으로 준비한다.
2. `finshield`를 사용자 확인 후 해당 Organization으로 이전한다.
3. 별도 private control 저장소에 외부 검증 workflow와 validator를 둔다.
4. Organization Ruleset의 `workflows` 규칙에서 control workflow를 정확한 commit SHA로 고정한다.
5. main 적용 Ruleset의 bypass actor를 0명으로 유지하고 strict required status를 켠다.
6. control은 열린 PR의 현재 merge SHA, trusted policy pin, Actions run·artifact 존재, archive digest와 27일 TTL을 조회한다.
7. control은 target 저장소가 발행자를 위조할 수 없는 GitHub App attestation을 만든다.
8. target validator는 발행자·대상 SHA·policy pin·신선도를 검증한다.
9. 실제 Ruleset 조회와 위조·stale·삭제 fixture를 통과한 뒤 별도 Adoption PR에서만 `B-CI-INTEGRITY`를 `PASS`로 바꾼다.

Organization 이전은 저장소 소유권과 결제에 영향을 주므로 자동으로 수행하지 않는다. 기존 개인/팀 Organization은 2026-09-04 조회 기준 모두 Free이며 현재 조건을 충족하지 않는다.

## 로컬 Preflight

관리 권한으로 Ruleset의 bypass actor까지 읽을 수 있는 token을 셸 환경에만 주입하고 실행한다.

```bash
GH_TOKEN="..." node .github/scripts/ci-integrity-preflight.mjs
```

출력에는 secret을 포함하지 않는다. 현재 저장소에서는 `BLOCKED`와 누락 조건을 반환하고 exit code 2로 종료하는 것이 정상이다. 모든 준비 조건을 갖춰도 결과는 `READY_FOR_EXTERNAL_ATTESTATION`일 뿐이며, ADR의 privileged control 검증 없이 `PASS`로 승격하지 않는다.

Contract test는 외부 호출 없이 실행한다.

```bash
node .github/scripts/test-ci-integrity-preflight.mjs
```
