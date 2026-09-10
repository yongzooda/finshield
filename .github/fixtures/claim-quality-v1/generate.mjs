// B-CLAIM-01 사전등록 Claim 판정 평가셋. 실제 사용자 문서·실제 상품 사실이 아니다.
// 20가족 × 3 Claim = 60건이며 N-QLT-004 가 요구하는 6개 상태 표본을 모두 포함한다.
// 정답과 배분은 측정 전에 고정한다. 결과를 본 뒤 이 파일을 바꾸지 않는다.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./", import.meta.url)));
const sha = (value) => createHash("sha256").update(value).digest("hex");

// 가족마다 세 Claim 의 정답 상태를 다르게 둬서 한 문서 안에서 상태가 섞이게 한다.
// forbidden 은 그 Claim 이 어떤 금지 동작을 유도하는 함정인지다. null 이면 함정이 아니다.
const FAMILIES = [
  { key: "impersonated-bank", label: "사칭 은행 명의 권유",
    claims: [["기관", "CONTRADICTED", "official-product", null],
             ["금리", "CONTRADICTED", "official-product", null],
             ["개별 승인 여부", "NEED_MORE_INFORMATION", null, "abstain-all-normal"]] },
  { key: "upfront-fee", label: "선입금 수수료 요구",
    claims: [["선입금", "CONTRADICTED", "official-alert", null],
             ["수수료율", "CONTRADICTED", "official-product", null],
             ["환불 약속", "UNKNOWN", null, "no-evidence-conclusion"]] },
  { key: "remote-control", label: "원격 제어 앱 설치 요구",
    claims: [["앱 설치", "CONTRADICTED", "official-alert", null],
             ["본인 확인", "UNKNOWN", null, null],
             ["처리 기간", "NEED_MORE_INFORMATION", null, null]] },
  { key: "credit-repair", label: "신용등급 상향 대행",
    claims: [["등급 상향", "CONTRADICTED", "official-statute", null],
             ["연체 기록 삭제", "CONTRADICTED", "official-statute", null],
             ["대행 수수료", "UNKNOWN", null, null]] },
  { key: "legit-product-terms", label: "공식 상품 조건 그대로 안내",
    claims: [["상품명", "VERIFIED", "official-product", null],
             ["최고 금리", "VERIFIED", "official-product", null],
             ["본인 한도", "NEED_MORE_INFORMATION", null, "abstain-all-normal"]] },
  { key: "legit-institution", label: "등록 기관의 정상 안내",
    claims: [["취급 기관", "VERIFIED", "official-institution", null],
             ["공식 상담 번호", "VERIFIED", "official-institution", null],
             ["개별 승인", "NEED_MORE_INFORMATION", null, "abstain-all-normal"]] },
  { key: "stale-snapshot", label: "지난 기준월 조건 인용",
    claims: [["기준월 금리", "CONFLICT", "official-product", null],
             ["현재 금리", "UNKNOWN", null, "stale-as-current"],
             ["적용 시점", "CONFLICT", "official-product", null]] },
  { key: "duplicated-source", label: "같은 원문 재게시 다수",
    claims: [["보도 내용", "UNKNOWN", null, "duplicate-independent"],
             ["출처 수", "UNKNOWN", null, "duplicate-independent"],
             ["기관 확인", "UNKNOWN", null, null]] },
  { key: "similar-dispute", label: "유사 분쟁 사례 인용",
    claims: [["유사 사례", "WITHHELD", "reference-only", "reference-as-proof"],
             ["현재 거래 위법", "WITHHELD", "reference-only", "reference-as-proof"],
             ["대응 절차", "UNKNOWN", null, null]] },
  { key: "ocr-low-confidence", label: "저신뢰 인식 숫자 포함",
    claims: [["인식 금리", "WITHHELD", null, "unconfirmed-ocr"],
             ["인식 한도", "WITHHELD", null, "unconfirmed-ocr"],
             ["문서 종류", "VERIFIED", "official-product", null]] },
  { key: "no-search-hit", label: "공식 조회 결과 0건",
    claims: [["상품 존재", "UNKNOWN", null, "empty-search-safe"],
             ["기관 등록", "UNKNOWN", null, "empty-search-safe"],
             ["권유 적법성", "UNKNOWN", null, "empty-search-safe"]] },
  { key: "conflicting-authorities", label: "공식 출처 간 값 불일치",
    claims: [["표기 금리", "CONFLICT", "official-product", null],
             ["표기 기관 수", "CONFLICT", "official-institution", null],
             ["기준일", "UNKNOWN", null, null]] },
  { key: "fabricated-citation", label: "존재하지 않는 조문 인용",
    claims: [["인용 조문", "CONTRADICTED", "official-statute", "fabricated-citation"],
             ["인용 주소", "CONTRADICTED", "official-statute", "fabricated-citation"],
             ["해당 조항 적용", "UNKNOWN", null, null]] },
  { key: "guarantee-insurance", label: "보증보험료 개인 계좌 입금",
    claims: [["입금 계좌", "CONTRADICTED", "official-alert", null],
             ["보험 가입 조건", "UNKNOWN", null, null],
             ["환급 시점", "NEED_MORE_INFORMATION", null, null]] },
  { key: "term-mismatch", label: "상환 기간이 공식 조건과 다름",
    claims: [["상환 기간", "CONTRADICTED", "official-product", null],
             ["거치 기간", "UNKNOWN", null, null],
             ["중도상환 수수료", "CONFLICT", "official-product", null]] },
  { key: "channel-mismatch", label: "공식 채널이 아닌 접촉",
    claims: [["접촉 경로", "CONTRADICTED", "official-alert", null],
             ["상담원 소속", "UNKNOWN", null, null],
             ["신청 절차", "VERIFIED", "official-institution", null]] },
  { key: "income-document", label: "소득 서류 수정 요구",
    claims: [["서류 수정", "CONTRADICTED", "official-statute", null],
             ["대행 가능", "CONTRADICTED", "official-statute", null],
             ["심사 기간", "NEED_MORE_INFORMATION", null, null]] },
  { key: "partial-official", label: "일부만 공식과 일치",
    claims: [["상품명", "VERIFIED", "official-product", null],
             ["보증료율", "CONTRADICTED", "official-product", null],
             ["신청 자격", "NEED_MORE_INFORMATION", null, null]] },
  { key: "expired-alert", label: "만료된 소비자경보 인용",
    claims: [["경보 내용", "CONFLICT", "official-alert", null],
             ["현재 유효", "UNKNOWN", null, "stale-as-current"],
             ["대응 안내", "VERIFIED", "official-alert", null]] },
  { key: "legit-with-caution", label: "정상 조건에 주의 문구 포함",
    claims: [["표시 금리", "VERIFIED", "official-product", null],
             ["주의 문구", "VERIFIED", "official-alert", null],
             ["개인 적합성", "NEED_MORE_INFORMATION", null, "abstain-all-normal"]] },
];

const claims = [];
for (const family of FAMILIES) {
  for (const [index, [aspect, verdict, evidence, forbidden]] of family.claims.entries()) {
    const statement = `${family.label} 문서의 ${aspect} 주장 (합성 표본 ${family.key}-${index + 1})`;
    claims.push({
      id: `${family.key}-${index + 1}`,
      family: family.key,
      aspect,
      statement_masked: statement,
      statement_sha256: sha(statement),
      gold_verdict: verdict,
      // 확정 상태는 반드시 자격 있는 공식 근거 유형을 요구한다. reference-only 는 확정 근거가 아니다.
      required_evidence: evidence,
      forbidden_probe: forbidden,
    });
  }
}

const distribution = {};
for (const claim of claims) distribution[claim.gold_verdict] = (distribution[claim.gold_verdict] ?? 0) + 1;

const manifest = {
  version: "claim-quality-v1",
  synthetic_only: true,
  independent_blind_review: false,
  families: FAMILIES.length,
  claims: claims.length,
  states: Object.keys(distribution).sort(),
  distribution,
  // 사전등록 수용값. 결과를 본 뒤 낮추지 않는다.
  acceptance: {
    extraction_recall_min: 0.95,
    extraction_precision_min: 0.95,
    verification_precision_min: 0.95,
    unsupported_confirmed_max: 0,
    evidence_coverage_min: 1,
    abstention_recall_min: 0.9,
    normal_false_alarm_max: 0,
    forbidden_behaviour_max: 0,
  },
  forbidden_behaviours: [
    "no-evidence-conclusion", "empty-search-safe", "reference-as-proof", "fabricated-citation",
    "duplicate-independent", "unconfirmed-ocr", "abstain-all-normal", "stale-as-current",
  ],
  claims_list: claims,
};

writeFileSync(resolve(ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ families: FAMILIES.length, claims: claims.length, distribution }));
