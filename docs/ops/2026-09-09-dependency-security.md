# 2026-09-09 의존성 보안 패치

로컬 필수 검사를 설치하는 과정에서 npm advisory 기준 취약점5건(critical1·high2·moderate2)을 확인했다. 패키지별 경고 수이며 고유 advisory 개수나 침해 발생 수가 아니다. 원본은 evidence/development/dependency-security/before-audit.json이다.

Next.js·eslint-config-next를16.3.1→16.3.4, sharp를0.35.3→0.35.4, Vitest/mocker를4.1.10→4.1.11, js-yaml을4.3.1→4.3.2로 갱신했다. 의존 그래프 안의 Vite·Rolldown 등 동반 패치도 lockfile에 고정한다. React19.2.8·Workflow4.8.5·Sandbox3.2.1과 별도 격리 PDF parser는 유지한다. Next16 내 patch 변경이므로 major API codemod는 적용하지 않았다.

- [Next Image Optimization AVIF 권고](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4): 수정판16.3.3 이상. 운영이 Windows가 아니라는 사실만으로 별도 AVIF 경고까지 무관하다고 판단하지 않았다.
- [sharp/libheif 권고](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c): 수정판0.35.4.
- [Vitest mocker 권고](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)와 [js-yaml merge 자원 소모 권고](https://github.com/advisories/GHSA-2883-xcg3-v3hh)도 수정판으로 갱신했다.

전역 npm11.4.2는 Vitest peer 계산에서 edgesOut 오류로 중단됐다. 전역 설치를 변경하지 않고 임시 npm11.11.0으로 lockfile을 갱신한 뒤 기존 npm의 clean ci가 통과했다. --force를 쓰지 않았고 audit 결과는0건이다. 이는 알려진 npm advisory 검사 결과이며 모든 보안 문제 부재를 뜻하지 않는다.

Production build·727 기본 테스트·lint 오류0(기존 경고2)이 통과했다. 선택적96skip은 실제 시험 성공으로 쓰지 않는다. 실제 merge candidate의 필수 검사와 배포·HTTP·DB 정합성은 PR에 이어 기록한다.

패키지가 scope에 포함된 B-MODEL-01·B-HEALTH-01은 기존 PASS를 재사용하지 않고 NOT-EVALUATED로 되돌렸다. 이전 채택 항목·결과는 보존했고 새 package pin을 등록했다. 나머지6개 채택 항목의 scope digest는 그대로다. Implementation NO-GO·Release NOT-EVALUATED 유지, 재채택은 main 실행·별도 Adoption 기준을 따른다.

최초 필수 검사는 과거 증거 원장에 허용되지 않는 NOT-EVALUATED 상태를 넣어 실패했다. blocker는 NOT-EVALUATED, 과거 증거 원장은 기존 schema의 STALE로 구분해 수정했다. 검증기나 허용 상태를 느슨하게 바꾸지 않았다. Next16.3.4 운영 빌드의 4개 화면·390px·키보드·브라우저 오류0, 비로그인 API 거부401/잘못된 로그인 입력400도 확인했다.
