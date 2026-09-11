/**
 * 처리를 맡기는 곳 (SEC-PRI-001·SEC-AI-008).
 *
 * 코드가 실제로 보내는 자료만 적는다. 각 회사의 보존·학습 사용·국외 이전 조건은
 * 계정 설정을 읽은 관측 기록이 아직 없으므로(`docs/ops/processor-privacy-inventory.md`)
 * 확인한 것처럼 적지 않는다. 처리자를 바꾸거나 보내는 자료가 달라지면 이 목록도
 * 같은 PR 에서 고친다.
 */
export const PROCESSORS: readonly { name: string; role: string; sends: string; when: string }[] = [
  {
    name: "Anthropic (Claude)",
    role: "확인 항목 판단과 독립 재확인",
    sends: "개인정보 검사를 통과한 권유·계약 문장, 확인 항목, 조회한 공식 자료 발췌",
    when: "검증과 가입 후 점검을 실행할 때",
  },
  {
    name: "Cohere",
    role: "공식 자료 검색 순위 계산",
    sends: "개인정보 검사를 통과한 확인 항목 문장과 공개 공식 자료 문단",
    when: "회원 검증에서 공식 자료를 찾을 때. 로그인 없는 체험에서는 보내지 않습니다.",
  },
  {
    name: "NAVER Cloud (CLOVA OCR)",
    role: "이미지·스캔 PDF 글자 인식",
    sends: "올린 원본 파일",
    when: "별도로 동의한 경우에만. 동의하지 않으면 보내지 않습니다.",
  },
  {
    name: "Supabase",
    role: "계정 인증과 기록 저장",
    sends: "이메일과 인증 정보, 검증 기록, 금융 프로필, 처리 중인 임시 파일",
    when: "가입·로그인과 기록을 남길 때",
  },
  {
    name: "Vercel",
    role: "서비스 실행과 전송",
    sends: "화면과 요청을 주고받는 데 필요한 통신 자료",
    when: "서비스를 이용하는 동안",
  },
];
