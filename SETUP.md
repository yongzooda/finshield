# 첫 커밋까지 — 복붙용

## 1. GitHub 리포 생성
github.com/new → 이름 `precase` → **Private** → README/gitignore/license **전부 체크 해제** → Create

## 2. 이 폴더에서 푸시

```bash
cd precase
git init
git add .
git commit -m "chore: 초기 스캐폴딩 — 명세서 기반 개발 규칙·DDL·적재 스크립트"
git branch -M main
git remote add origin https://github.com/<계정>/precase.git
git push -u origin main
```

## 3. Next.js 얹기

기존 파일을 지우지 않도록 현재 폴더에 생성한다.

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --no-import-alias
```

충돌 물어보면 README.md·.gitignore는 **keep**(우리 것 유지).

## 4. 문서 복사
노션 명세서 10종을 `docs/` 에 마크다운으로 내보낸다. 파일명 규칙:

```
docs/00-plan.md        기획서
docs/01-scope.md       서비스 범위
docs/02-functional.md  기능
docs/03-data.md        데이터
docs/04-screen.md      화면
docs/05-auth.md        권한
docs/06-integration.md 외부 연동
docs/07-exception.md   예외처리
docs/08-nfr.md         비기능
docs/09-glossary.md    용어 정의
docs/10-db.md          DB 명세서
```

노션 페이지 우상단 ··· → Export → Markdown & CSV.

## 5. Vercel 연결
vercel.com → Add New Project → 리포 선택 → 환경변수는 나중에

⚠️ 판단 파이프라인이 P95 120초라 함수 실행 시간 제한에 걸린다.
플랜별 maxDuration 확인하고 스트리밍 구조를 처음부터 잡을 것.
