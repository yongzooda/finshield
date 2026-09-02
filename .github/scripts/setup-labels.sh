#!/usr/bin/env bash
set -euo pipefail

repo="${1:-yongzooda/finshield}"

for label in enhancement "good first issue" help wanted invalid question wontfix duplicate documentation bug; do
  gh label delete "$label" --repo "$repo" --yes >/dev/null 2>&1 || true
done

create_label() {
  gh label create "$1" --color "$2" --description "$3" --repo "$repo" --force
}

create_label feat 1D76DB "새 기능"
create_label fix D73A4A "결함 수정"
create_label chore C5DEF5 "설정·정리"
create_label docs 0075CA "문서"
create_label refactor 5319E7 "구조 개선"
create_label test BFD4F2 "테스트"
create_label "SCP 범위" 0E8A16 "서비스 범위·우선순위"
create_label "F 기능" 0052CC "기능 요구사항"
create_label "S 화면" FBCA04 "화면·사용자 흐름"
create_label "D 데이터" 006B75 "논리 데이터"
create_label "AI 에이전트" 8B5CF6 "Agent·RAG·CoVe·Evidence Policy"
create_label "E 연동" 1D76DB "API·MCP"
create_label "N 비기능" B60205 "성능·가용성·접근성"
create_label "SEC 보안" D93F0B "개인정보·RLS·파일·Prompt Injection"
create_label DB 0366D6 "Schema·Migration·Index"
create_label "배포 조건" 000000 "통과하지 못하면 배포할 수 없는 게이트"
