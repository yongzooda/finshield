/* 자동 생성 — demo-generate-live.test.ts. 손으로 고치지 말 것.
   실제 도구(analyze_risk_pattern · check_documents) 반환값이다. */

export default {
  "risk": {
    "granularity": "PRODUCT",
    "matched": {
      "productCode": "INS_SAVINGS",
      "channel": null,
      "trait": null
    },
    "issues": [
      {
        "issueCode": "약관해석",
        "issueLabel": "약관해석",
        "nCases": 2,
        "nUpheld": 1,
        "nRejected": 1
      },
      {
        "issueCode": "보험금지급범위",
        "issueLabel": "보험금지급범위",
        "nCases": 1,
        "nUpheld": 1,
        "nRejected": 0
      }
    ],
    "statBasis": "DECISION_253",
    "fellBack": true
  },
  "docs": {
    "required": [
      {
        "key": "contract",
        "label": "계약서·증권 사본",
        "why": "어떤 계약인지 특정하는 기본 자료입니다",
        "origin": "COMMON",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "contract_date",
        "label": "가입 시점을 알 수 있는 자료",
        "why": "가입 시점에 따라 적용되는 법이 달라집니다",
        "origin": "COMMON",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "explain_confirm",
        "label": "설명 확인서·서명본",
        "why": "은행 창구·홈쇼핑 판매에서 설명 여부를 다투는 핵심 자료입니다",
        "origin": "CHANNEL",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "broadcast_capture",
        "label": "방송·상담 화면 캡처",
        "why": "홈쇼핑이라면 당시 고지 화면이 근거가 됩니다",
        "origin": "CHANNEL",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "terms_at_contract",
        "label": "가입 당시 약관",
        "why": "약관은 개정되므로 지금 약관이 아니라 가입 시점 약관이 기준입니다",
        "origin": "ISSUE",
        "issueCode": "약관해석",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "medical_record",
        "label": "진단서·진료기록",
        "why": "지급 사유에 해당하는지 판단하는 근거입니다",
        "origin": "ISSUE",
        "issueCode": "보험금지급범위",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "claim_form",
        "label": "보험금 청구서 사본",
        "why": "무엇을 어떤 사유로 청구했는지 확인합니다",
        "origin": "ISSUE",
        "issueCode": "보험금지급범위",
        "source": "CURATED",
        "possessed": false
      }
    ],
    "missing": [
      {
        "key": "contract",
        "label": "계약서·증권 사본",
        "why": "어떤 계약인지 특정하는 기본 자료입니다",
        "origin": "COMMON",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "contract_date",
        "label": "가입 시점을 알 수 있는 자료",
        "why": "가입 시점에 따라 적용되는 법이 달라집니다",
        "origin": "COMMON",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "explain_confirm",
        "label": "설명 확인서·서명본",
        "why": "은행 창구·홈쇼핑 판매에서 설명 여부를 다투는 핵심 자료입니다",
        "origin": "CHANNEL",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "broadcast_capture",
        "label": "방송·상담 화면 캡처",
        "why": "홈쇼핑이라면 당시 고지 화면이 근거가 됩니다",
        "origin": "CHANNEL",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "terms_at_contract",
        "label": "가입 당시 약관",
        "why": "약관은 개정되므로 지금 약관이 아니라 가입 시점 약관이 기준입니다",
        "origin": "ISSUE",
        "issueCode": "약관해석",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "medical_record",
        "label": "진단서·진료기록",
        "why": "지급 사유에 해당하는지 판단하는 근거입니다",
        "origin": "ISSUE",
        "issueCode": "보험금지급범위",
        "source": "CURATED",
        "possessed": false
      },
      {
        "key": "claim_form",
        "label": "보험금 청구서 사본",
        "why": "무엇을 어떤 사유로 청구했는지 확인합니다",
        "origin": "ISSUE",
        "issueCode": "보험금지급범위",
        "source": "CURATED",
        "possessed": false
      }
    ],
    "relatedClauses": [
      {
        "clauseText": "일반교통사고로 피해자에게 중상해를 입혀 형법 제258조 제1항 또는 제2항, 형법 제268조 또는 교특법 제3조에 따라 검찰에 의해 공소제기 되거나 자배법 시행령 제3조에서 정한 상해급수 1급, 2급 또는 3급에 해당하는 부상을 입힌 경우",
        "sector": "INVESTMENT",
        "productCode": "INS_AUTO",
        "fromDecisionNo": "제2026-3호",
        "issueCode": "약관해석"
      },
      {
        "clauseText": "피보험자의 기질성 치매를 제외한 정신적 기능장애, 선천성 뇌질환 및 심신상실",
        "sector": "INSURANCE",
        "productCode": "INS_ETC",
        "fromDecisionNo": "제2010-83호",
        "issueCode": "약관해석"
      },
      {
        "clauseText": "피보험자의 심신상실, 정신적 기능장해 및 선천성 뇌질환",
        "sector": "INSURANCE",
        "productCode": "INS_ETC",
        "fromDecisionNo": "제2010-83호",
        "issueCode": "약관해석"
      },
      {
        "clauseText": "하나의 장해에 다른 장해가 통상 파생하는 경우 각각 그 중 높은 지급률만을 적용한다",
        "sector": "INSURANCE",
        "productCode": "INS_ETC",
        "fromDecisionNo": "제2010-104호",
        "issueCode": "약관해석"
      },
      {
        "clauseText": "같은 사고로 두 가지 이상의 후유장해가 생긴 경우에는 후유장해 지급률을 합산하여 지급합니다. 다만, 장해분류표의 각 신체부위별 판정기준에서 별도로 정한 경우에는 그 기준에 따릅니다",
        "sector": "INSURANCE",
        "productCode": "INS_ETC",
        "fromDecisionNo": "제2010-104호",
        "issueCode": "약관해석"
      }
    ],
    "channelUnknown": false,
    "flagged": 0
  },
  "product": "INS_SAVINGS",
  "channel": "BANCA_HS",
  "age": 63
} as const;
