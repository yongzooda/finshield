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
| Fixture 생성기 | `file-safety-fixtures-v2`. 바이트를 결정적으로 만들고 정책이 SHA-256을 다시 계산해 대조한다. v2는 휴대폰 사진 끝 구조와 두 글자 key 문법 Fixture를 더했다 |
| 한도 | 파일 10 MiB, PDF 10쪽, 이미지 한 장 2,500만 pixel, 문서 합계 1억 pixel, 해제 32 MiB, 간접 객체 50,000개, 중첩 128, `%%EOF` 뒤 1,024바이트 |
| 허용 형식 | `application/pdf`, `image/png`, `image/jpeg`. 확장자·선언 MIME·Magic Byte가 모두 맞아야 한다 |
| Parser | `pdfjs-dist` 6.3.289. 저장소 루트가 아니라 `.github/fixtures/file-safety-parser/`의 lockfile로 고정한다. 루트 `package-lock.json`은 `B-MODEL-01` 증거 scope라 건드리지 않는다 |
| 격리 | Fixture마다 새 프로세스. Linux에서 network namespace를 끊고, Node 권한 모델로 읽기 경로만 열고, 환경변수를 `env -i`로 `PATH` 하나로 줄이고, heap 상한 512 MB, 기본 wall 30초 |
| guard | `file-safety-guard.mjs`가 `net`·`tls`·`http`·`https`·`dns`·`fetch`·`WebSocket`을 막고 시도 횟수를 센다. namespace가 1차 방어이고 guard는 관측기다 |
| namespace mode | `userns`는 권한 없는 user namespace다. Ubuntu 24.04는 AppArmor가 그것을 막으므로(run `34024928680`의 `write failed /proc/self/uid_map`) `sudo`로 network namespace만 만들고 `setpriv`로 곧바로 원래 사용자로 내려간다. 어느 쪽이든 worker는 권한 없는 사용자로 돌고 network가 없다. 쓴 mode를 결과에 남긴다 |
| 음성 대조 | 같은 worker에 canary를 일부러 넣은 실행을 한 번 더 한다. 탐지되지 않으면 결과를 만들지 않는다 |

## 합격선

- 위험 입력 Fixture가 50건 이상이고, 그 전부가 `REJECT`이며 사유가 분류의 사유 가족 안에 있다.
- 정상 입력 Fixture가 전부 `ACCEPT`이고 사유가 하나도 남지 않는다. 그중 PDF는 Parser 단계까지 가서 숫자·부정어·표지 문구를 보존한다.
- worker가 본 환경변수에 secret 형태 이름이 0개이고 allowlist 밖 이름도 0개다. canary 유출 0건, network 시도 0건.
- worker의 파일 쓰기·바깥 읽기·child process·worker thread가 모두 거부된다.
- network canary 실행에서 격리 밖 연결이 성공하지 않는다.
- 주입한 fault 여섯 종이 모두 worker 안에서 끝나고 어느 것도 파일 판정값을 만들지 않는다. 모드별 종료 형태와 시간 상한 사용 여부가 계약과 같다. heap 소진은 스스로 끝나야 하고 시간 상한으로 끝나면 미달이다.

## 분류와 기대 판정

| 분류 | 기대 | 최소 건수 | 내용 |
|---|---|---:|---|
| `benign` | `ACCEPT` | 8 | 1·3·10쪽 PDF, Flate 본문, 작은 이미지, 문서 안 이동만 하는 `/OpenAction`, URI 링크, 정확히 10 MiB, PNG·JPEG, Samsung SEFT 꼬리가 붙은 JPEG·PNG, HDR gain map MPF JPEG, 그림 바이트가 우연히 `/JS`·`/AA`·`/EF`처럼 보이는 PDF |
| `encrypted` | `REJECT` | 3 | RC4·AES·PubSec 암호화, xref stream 사전에만 있는 `/Encrypt` |
| `active` | `REJECT` | 8 | `/JavaScript`·`/Launch`·`/SubmitForm`·`/ImportData`·`/RichMedia`·`/XFA`·`/AA`·`/GoToR`·`/Movie`, 이름 escape, 객체 stream·중첩 Flate 안에 숨긴 것, 주석 뒤 `/JS` 값, 간접 참조 `/AA`, 이름 escape 뒤 리터럴 부호 객체 stream |
| `embedded` | `REJECT` | 3 | `/EmbeddedFiles` 이름 트리, 첨부 주석, 실행 파일 payload, 간접 참조 `/EF`, 사진 꼬리 블록 속 실행 파일 |
| `polyglot` | `REJECT` | 10 | ZIP 덧붙임, PDF·이미지 교차, 선언 MIME 불일치, 이중 확장자, 이름 바꾼 실행 파일, 경로 이동·NUL 파일명, 사진 꼬리 흉내(가짜 SEFT, 블록 사이 빈틈, 꼬리 속 HTML·ZIP, MPF 위치 어긋남, 설명되지 않는 나머지 바이트) |
| `bomb` | `REJECT` | 8 | 11쪽·200쪽, 쪽수 거짓말, 2만×2만 이미지, pixel 합계, 40 MiB 해제, 중첩 Flate, 객체 수, 중첩 깊이, 10 MiB 초과 |
| `malformed` | `REJECT` | 8 | 빈 파일, 잘린 문서, `%%EOF` 없음, `startxref` 어긋남, 쪽 객체 없음, PNG CRC·잘림·0 너비, JPEG SOF 없음 |
| `fault` | 봉쇄 | 5 | abort, 무한 루프(시간 상한), heap 소진(heap 한도), 비정상 종료 코드, JSON 아닌 stdout, network canary |

## 휴대폰 사진 끝 구조와 두 글자 key (v2)

휴대폰 카메라는 그림 끝(JPEG EOI·PNG IEND) 뒤에 정해진 구조를 붙인다. v1은 그 뒤의 바이트를 모두 `trailing-data`로 거부해 Samsung 사진·HDR 사진·Samsung PNG 캡처가 올라가지 않았다. v2는 아래 두 구조가 정확히 맞을 때만 받아들이고, 조금이라도 어긋나거나 설명하지 못하는 바이트가 남으면 그대로 거부한다.

- Samsung 확장 정보(SEFT): 마지막 8바이트가 SEFH 디렉터리 길이와 `SEFT`다. 항목마다 거꾸로 센 거리와 크기가 있고, 블록은 항목과 같은 머리 4바이트·이름 길이·영숫자 이름으로 시작한다. 블록은 겹치거나 비지 않고 이어져 디렉터리 바로 앞에서 끝나야 한다. 해석은 ExifTool `Samsung.pm`의 `ProcessSamsung`과 같다.
- Multi-Picture Format(MPF, CIPA DC-007): 첫 그림의 APP2 `MPF\0`가 적은 보조 그림이 첫 그림 바로 뒤에 빈틈 없이 이어져야 하고, 각각 EOI로 정확히 끝나는 온전한 JPEG여야 한다. 보조 그림에도 화소 한도를 적용한다.
- 받아들인 꼬리 안에 웹 문서 조각이 있으면 `polyglot-html`, 블록 자료가 실행 파일로 시작하면 `executable-payload`로 거부한다. ZIP·PDF 서명 검사는 파일 전체에 그대로 적용한다.

PDF의 `/JS`·`/AA`·`/EF`는 두 글자라 압축 바이트·그림 화소에서도 우연히 나온다. v1은 몇 MB PDF에서 몇 퍼센트 확률로 정상 문서를 거부했다. v2는 이 key가 문법상 값을 가질 때만 센다(`/JS`는 문자열·hex 문자열·간접 참조, `/AA`·`/EF`는 사전·간접 참조). key와 값 사이의 공백·주석은 Parser처럼 건너뛴다. 풀어서 따로 훑는 Flate stream과 그림 전용 부호(DCT·JPX·CCITT·JBIG2) stream의 원시 바이트는 첫 탐색 본문에서 지운다. 풀지 못한 stream은 그대로 훑는다.

stream 위치는 원시 바이트 기준으로 계산한다. v1은 이름의 `#xx`를 푼 문자열에서 위치를 계산해, 그 앞에 escape가 있으면 뒤 stream을 엉뚱한 위치에서 풀고 실패했다. 원시 바이트에 드러나지 않게 압축한 객체 stream 속 JavaScript를 놓칠 수 있었고, v2 Fixture `active-object-stream-after-name-escapes`가 이 경로를 막는다.

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
- 두 mode 모두 쓸 수 없는 실행 환경에서는 증거를 만들 수 없다. 우회 경로를 두지 않는다.
- `sudo` mode는 namespace를 만들 때만 권한을 쓰고 worker 자체는 원래 사용자로 돈다. 부모 harness가 sudo를 쓸 수 있는 실행 환경이라는 사실은 결과에 남는다.
- 이미지 pixel 한도는 헤더에 적힌 크기로 판단한다. 실제 decode는 하지 않으므로 decode 비용 자체는 이 blocker의 관측이 아니다.
- Fixture는 구조만 유효한 최소 문서다. 실제 스캔 문서의 다양성을 대신하지 않는다.
