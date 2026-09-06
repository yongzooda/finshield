# B-FILE-SAFETY 파일 안전 검사 운영 절차

## 상태와 범위

- 요구사항: `N-QLT-010`의 `B-FILE-SAFETY`. 상위 기준은 `INP-003`·`INP-004`·`INP-005`, `SEC-FILE-002`~`SEC-FILE-004`, ADR 6.1·6.2다.
- 현재 상태: `NOT-EVALUATED`
- 이 문서는 검토된 harness의 실행 계약이다. workflow 성공만으로 `PASS`가 되지 않는다.
- 입력은 전부 합성 Fixture다. 실제 문서·개인정보를 쓰지 않는다. 결과에는 파일 원문도 환경변수 값도 남기지 않는다.
- 이 blocker는 Parser 이전 검사와 격리 실행만 다룬다. OCR 정확도는 `B-OCR-01`, Storage 정책은 `B-STORAGE-01`, 물리 삭제는 `B-DELETE-01`이 따로 measure한다.

## 사전 고정 계약

| 항목 | 고정값 |
|---|---|
| 산식 버전 | `file-safety-isolated-parser-fixture-matrix-v1` |
| Fixture 생성기 | `file-safety-fixtures-v1`. 바이트를 결정적으로 만들고 정책이 SHA-256을 다시 계산해 대조한다 |
| 한도 | 파일 10 MiB, PDF 10쪽, 이미지 한 장 2,500만 pixel, 문서 합계 1억 pixel, 해제 32 MiB, 간접 객체 50,000개, 중첩 128, `%%EOF` 뒤 1,024바이트 |
| 허용 형식 | `application/pdf`, `image/png`, `image/jpeg`. 확장자·선언 MIME·Magic Byte가 모두 맞아야 한다 |
| Parser | `pdfjs-dist` 6.3.289. 저장소 루트가 아니라 `.github/fixtures/file-safety-parser/`의 lockfile로 고정한다. 루트 `package-lock.json`은 `B-MODEL-01` 증거 scope라 건드리지 않는다 |
| 격리 | Fixture마다 새 프로세스. Linux `unshare --map-root-user --net`로 network namespace를 끊고, Node 권한 모델로 읽기 경로만 열고, 환경변수를 `PATH` 하나로 줄이고, heap 상한 512 MB, 기본 wall 30초 |
| guard | `file-safety-guard.mjs`가 `net`·`tls`·`http`·`https`·`dns`·`fetch`·`WebSocket`을 막고 시도 횟수를 센다. namespace가 1차 방어이고 guard는 관측기다 |
| 음성 대조 | 같은 worker에 canary를 일부러 넣은 실행을 한 번 더 한다. 탐지되지 않으면 결과를 만들지 않는다 |

## 합격선

- 위험 입력 Fixture가 50건 이상이고, 그 전부가 `REJECT`이며 사유가 분류의 사유 가족 안에 있다.
- 정상 입력 Fixture가 전부 `ACCEPT`이고 사유가 하나도 남지 않는다. 그중 PDF는 Parser 단계까지 가서 숫자·부정어·표지 문구를 보존한다.
- worker가 본 환경변수에 secret 형태 이름이 0개이고 allowlist 밖 이름도 0개다. canary 유출 0건, network 시도 0건.
- worker의 파일 쓰기·바깥 읽기·child process·worker thread가 모두 거부된다.
- network canary 실행에서 격리 밖 연결이 성공하지 않는다.
- 주입한 fault 여섯 종이 모두 worker 안에서 끝나고 어느 것도 파일 판정값을 만들지 않는다. 모드별 종료 형태가 계약과 같다.

## 분류와 기대 판정

| 분류 | 기대 | 최소 건수 | 내용 |
|---|---|---:|---|
| `benign` | `ACCEPT` | 8 | 1·3·10쪽 PDF, Flate 본문, 작은 이미지, 문서 안 이동만 하는 `/OpenAction`, URI 링크, 정확히 10 MiB, PNG·JPEG |
| `encrypted` | `REJECT` | 3 | RC4·AES·PubSec 암호화, xref stream 사전에만 있는 `/Encrypt` |
| `active` | `REJECT` | 8 | `/JavaScript`·`/Launch`·`/SubmitForm`·`/ImportData`·`/RichMedia`·`/XFA`·`/AA`·`/GoToR`·`/Movie`, 이름 escape, 객체 stream·중첩 Flate 안에 숨긴 것 |
| `embedded` | `REJECT` | 3 | `/EmbeddedFiles` 이름 트리, 첨부 주석, 실행 파일 payload |
| `polyglot` | `REJECT` | 10 | ZIP 덧붙임, PDF·이미지 교차, 선언 MIME 불일치, 이중 확장자, 이름 바꾼 실행 파일, 경로 이동·NUL 파일명 |
| `bomb` | `REJECT` | 8 | 11쪽·200쪽, 쪽수 거짓말, 2만×2만 이미지, pixel 합계, 40 MiB 해제, 중첩 Flate, 객체 수, 중첩 깊이, 10 MiB 초과 |
| `malformed` | `REJECT` | 8 | 빈 파일, 잘린 문서, `%%EOF` 없음, `startxref` 어긋남, 쪽 객체 없음, PNG CRC·잘림·0 너비, JPEG SOF 없음 |
| `fault` | 봉쇄 | 5 | abort, 무한 루프, heap 소진, 비정상 종료 코드, JSON 아닌 stdout, network canary |

`malformed-kids-dangling-reference`처럼 검사기가 잡지 못하는 구조는 Parser 단계에서 거부된다. 검사기와 Parser 중 어디서 걸렸는지 결과의 `stage`에 남는다.

## 실행

1. `File Safety Evidence` workflow를 main에서 `B-FILE-SAFETY`로 dispatch한다. 외부 secret이 필요 없다.
2. workflow가 lockfile로 Parser를 설치하고 network namespace를 쓸 수 있는지 먼저 확인한다. 끊지 못하면 결과를 만들지 않는다.
3. 정책 미달이면 결과 파일을 만들지 않는다. 실패 사유는 종류만 로그에 남는다.
4. 별도 Adoption PR에서 artifact를 `evidence/`에 채택하고 ADR 14.1·14.2를 갱신한다.

## 로컬 재현

```bash
node .github/scripts/test-file-safety-evidence.mjs
```

계약 시험은 외부 호출 없이 돈다. Fixture 결정성, 검사기 판정, 가짜 격리 worker로 조립한 관측, 정책이 무엇을 거부하는지를 확인한다. 실제 격리 실행은 Linux에서만 가능하므로 macOS에서는 `runFileSafetySpike`가 결과를 만들지 않는다.

## 알려진 한계

- 이 harness는 Parser 이전 검사와 실행 격리를 measure한다. 실제 악성 문서 corpus나 상용 Malware Scanner는 쓰지 않는다. `SEC-FILE-007`은 P1이다.
- `unshare`가 없는 실행 환경에서는 증거를 만들 수 없다. 우회 경로를 두지 않는다.
- 이미지 pixel 한도는 헤더에 적힌 크기로 판단한다. 실제 decode는 하지 않으므로 decode 비용 자체는 이 blocker의 관측이 아니다.
- Fixture는 구조만 유효한 최소 문서다. 실제 스캔 문서의 다양성을 대신하지 않는다.
