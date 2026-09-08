// B-RETRIEVAL-01 Fast 재평가용 합성 평가셋 생성기.
// Provider 결과를 보기 전에 가족·정답·hard negative를 결정적으로 고정한다.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const families = [
  ["guarantee_fee_refund", "솔바람보증", "SB-GR1 보증부대출", ["fees", "freshness"], false, [
    ["보증료 환급", "중도상환하면 남은 보증기간의 보증료를 일할 계산해 환급한다.", "중도상환 뒤 남은 기간의 보증료를 돌려받는다고 안내받았다."],
    ["환급 기한", "환급액은 상환 완료일 다음 영업일부터 10영업일 안에 지급한다.", "보증료 환급은 상환 뒤 10영업일 안에 처리된다고 들었다."],
    ["환급 계좌", "환급금은 차주 본인 명의로 확인된 계좌에만 입금한다.", "보증료 환급금은 차주 본인 명의 계좌로 받는다고 안내받았다."],
    ["보증료율", "연 보증료율은 보증 잔액의 1.8%이며 대출금리와 별도다.", "보증료율이 보증 잔액의 연 1.8%라고 들었다."],
    ["미납 상계", "연체 보증료가 있으면 환급액에서 먼저 상계하고 내역을 알린다.", "미납 보증료는 환급액에서 상계될 수 있다고 안내받았다."],
  ]],
  ["prepayment_waiver", "푸른언덕은행", "PH-PW2 가계신용대출", ["fees", "numeric"], false, [
    ["부과 기간", "중도상환수수료는 대출 실행일부터 3년 동안만 부과한다.", "중도상환수수료가 실행 후 3년까지만 붙는다고 들었다."],
    ["면제 시점", "대출 실행 3년이 지난 뒤 상환하는 금액에는 중도상환수수료가 없다.", "실행 3년 뒤에는 중도상환수수료가 없다고 안내받았다."],
    ["계산 방식", "수수료는 상환원금과 0.7% 요율 및 남은 일수 비율을 곱해 계산한다.", "중도상환수수료 계산에 상환원금과 0.7% 요율이 쓰인다고 들었다."],
    ["부분 상환", "원금 일부만 갚아도 그 상환원금에 같은 수수료 계산식을 적용한다.", "일부 상환에도 상환한 원금 기준 수수료가 적용된다고 안내받았다."],
    ["재난 면제", "공식 재난 피해 지원 대상으로 확인되면 증빙 접수 뒤 수수료를 면제한다.", "재난 피해 지원 대상은 증빙 후 중도상환수수료를 면제받는다고 들었다."],
  ]],
  ["variable_rate_reset", "새물결은행", "SM-VR3 변동금리대출", ["numeric", "freshness"], false, [
    ["변동 주기", "대출금리는 실행일을 기준으로 6개월마다 다시 산정한다.", "금리가 실행일 기준 6개월마다 바뀐다고 안내받았다."],
    ["기준금리", "재산정일의 신규취급액 기준 코픽스를 기준금리로 사용한다.", "금리 재산정에 신규취급액 코픽스를 쓴다고 들었다."],
    ["가산금리", "약정한 가산금리 2.1%포인트는 계약 변경이 없으면 유지한다.", "가산금리 2.1%포인트는 계약 변경 전까지 고정이라고 안내받았다."],
    ["사전 안내", "변경 금리는 적용일 7일 전까지 앱과 전자문서로 알린다.", "변경 금리를 적용 7일 전에 알린다고 들었다."],
    ["상한 오인", "기준금리가 내려도 전체 대출금리가 연 3%로 자동 고정되는 약정은 없다.", "기준금리가 내리면 전체 금리가 연 3%로 자동 고정된다는 말을 들었다."],
  ]],
  ["grace_period_limit", "한빛저축은행", "HB-GP4 원리금대출", ["product", "numeric"], false, [
    ["거치 기간", "이 상품의 이자만 납부하는 거치기간은 최대 12개월이다.", "이자만 내는 거치기간이 최대 12개월이라고 안내받았다."],
    ["원금 개시", "거치 12개월을 선택하면 13회차부터 원금과 이자를 함께 납부한다.", "12개월 거치 뒤 13회차부터 원금을 갚는다고 들었다."],
    ["연장 심사", "거치기간 연장은 자동이 아니며 만료 전 소득과 상환능력을 다시 심사한다.", "거치기간 연장은 재심사를 받아야 한다고 안내받았다."],
    ["이자 납부", "거치기간에도 매월 약정일에 발생 이자를 전액 납부해야 한다.", "거치 중에도 매달 이자를 내야 한다고 들었다."],
    ["연체 영향", "거치 중 이자를 연체하면 연장 심사와 기한이익 유지에 영향을 줄 수 있다.", "거치 중 이자 연체가 거치 연장에 영향을 줄 수 있다고 안내받았다."],
  ]],
  ["bridge_loan_cost", "마루캐피탈", "MR-BL5 잔금연결대출", ["fees", "product"], false, [
    ["취급수수료", "대출 실행을 조건으로 회사가 받는 별도 취급수수료는 없다.", "잔금연결대출에 회사 취급수수료가 없다고 안내받았다."],
    ["인지세", "인지세 과세 대상이면 고객과 회사가 법정 인지세를 절반씩 부담한다.", "인지세가 생기면 회사와 절반씩 부담한다고 들었다."],
    ["이용 기간", "대출기간은 실행일부터 잔금 지급일까지 최대 6개월이다.", "잔금연결대출 기간이 최대 6개월이라고 안내받았다."],
    ["상환 재원", "잔금대출 실행금으로 이 연결대출 원리금을 우선 상환한다.", "잔금대출 실행금으로 연결대출을 먼저 갚는다고 들었다."],
    ["연장 조건", "잔금 일정 변경만으로 만기가 자동 연장되지 않으며 별도 승인이 필요하다.", "잔금 일정이 바뀌면 별도 승인을 받아야 한다고 안내받았다."],
  ]],
  ["refinance_cash_request", "다온금융", "DO-RF6 대환안심대출", ["risk", "fees"], true, [
    ["선입금 금지", "공식 대환 절차는 승인이나 한도 확인을 이유로 현금 선입금을 요구하지 않는다.", "대환 승인을 받으려면 먼저 현금을 보내야 한다는 안내를 받았다."],
    ["상환 계좌", "기존 채무 상환금은 확인된 기존 금융회사 명의 계좌로만 지급한다.", "기존 대출 상환금을 상담사 개인 계좌로 보내도 된다는 말을 들었다."],
    ["수수료 금지", "대환 중개를 이유로 상담사가 별도 성공보수나 작업비를 받을 수 없다.", "대환이 끝나면 상담사에게 성공보수를 내야 한다는 안내를 받았다."],
    ["본인 확인", "본인 확인은 공식 앱이나 영업점에서 진행하며 메신저로 신분증 원본을 받지 않는다.", "메신저로 신분증 원본을 보내 본인 확인을 하라는 말을 들었다."],
    ["중단 조치", "개인 계좌 송금을 요구받으면 거래를 중단하고 공식 대표번호로 사실을 확인한다.", "개인 계좌 송금 요구가 있어도 먼저 보내고 나중에 확인하라는 안내를 받았다."],
  ]],
  ["consultant_deposit", "온새미은행", "OS-CD7 상담예약대출", ["risk", "mixed_name"], true, [
    ["예약금 금지", "공식 대출상담 예약에는 보증금이나 좌석 확보금을 받지 않는다.", "상담 예약 자리를 잡으려면 보증금을 보내야 한다는 말을 들었다."],
    ["직원 확인", "상담 직원은 공식 대표번호와 직원 조회 절차로 재확인할 수 있다.", "직원 여부는 개인 명함의 휴대전화만 믿으면 된다는 안내를 받았다."],
    ["보안카드", "직원은 대출상담 과정에서 보안카드 전체 번호를 요구하지 않는다.", "대출상담을 위해 보안카드 번호 전부를 알려 달라는 요청을 받았다."],
    ["원격 제어", "상담 예약이나 심사를 위해 원격 제어 앱을 설치하게 하지 않는다.", "심사를 위해 원격 제어 앱을 설치해야 한다는 말을 들었다."],
    ["공식 확인", "의심되는 상담은 송금 전에 대표번호로 예약과 직원 소속을 확인한다.", "예약금을 보낸 뒤 대표번호로 확인해도 된다는 안내를 받았다."],
  ]],
  ["remote_app_install", "누리상호금융", "NR-RA8 모바일신용대출", ["risk", "channel"], true, [
    ["앱 설치 경로", "대출 앱은 공식 앱스토어와 기관 홈페이지가 안내한 경로에서만 설치한다.", "상담사가 보낸 설치 파일로 대출 앱을 설치하라는 안내를 받았다."],
    ["접근성 권한", "대출 심사를 이유로 휴대전화 접근성 권한이나 화면 제어 권한을 요구하지 않는다.", "심사를 위해 휴대전화 화면 제어 권한을 켜 달라는 요청을 받았다."],
    ["악성앱 점검", "비공식 앱을 설치했다면 송금을 멈추고 다른 안전한 전화로 공식 기관에 확인한다.", "비공식 앱을 설치했어도 같은 전화로 상담사에게만 확인하면 된다고 들었다."],
    ["인증번호", "직원은 문자 인증번호를 전화나 메신저로 전달하라고 요구하지 않는다.", "대출 실행을 위해 문자 인증번호를 상담사에게 알려 달라는 요청을 받았다."],
    ["삭제 전 조치", "의심 앱은 증거와 신고에 필요한 정보를 보존한 뒤 공식 안내에 따라 제거한다.", "의심 앱을 발견하면 아무 기록 없이 즉시 삭제만 하라는 안내를 받았다."],
  ]],
  ["account_transfer_check", "해오름신협", "HO-AT9 전환지원대출", ["risk", "mixed_name"], true, [
    ["입금 계좌 명의", "대출 관련 납부 계좌는 해오름신협 명의가 확인된 계좌만 사용한다.", "해오름신협 대출금을 해오름신용협회 명의 계좌로 보내라는 안내를 받았다."],
    ["계좌 변경", "납부 계좌 변경은 공식 앱과 영업점 공지를 함께 확인해야 한다.", "메신저 한 통만으로 납부 계좌가 바뀔 수 있다는 말을 들었다."],
    ["소액 인증", "대출 승인을 위한 개인 계좌 소액 송금 인증 절차는 운영하지 않는다.", "승인을 위해 개인 계좌로 소액을 보내 인증하라는 안내를 받았다."],
    ["반환 약속", "먼저 송금하면 즉시 반환한다는 약속은 공식 계좌 확인을 대신하지 않는다.", "개인 계좌로 먼저 보내도 곧 돌려주니 안전하다는 말을 들었다."],
    ["확인 전화", "송금 전 통화는 메시지에 적힌 번호가 아닌 공식 대표번호로 다시 건다.", "메시지에 적힌 번호로만 확인 전화를 하라는 안내를 받았다."],
  ]],
  ["loan_certificate_fee", "별샘저축은행", "BS-LC10 서민지원대출", ["risk", "fees"], true, [
    ["인증서 발급비", "대출 승인을 위한 금융인증서 발급비나 전산 등록비를 별도로 받지 않는다.", "승인을 위해 금융인증서 발급비를 먼저 내라는 안내를 받았다."],
    ["세금 선납", "대출금 수령 전에 소득세나 보증 세금을 개인 계좌로 선납하게 하지 않는다.", "대출금을 받기 전에 세금을 개인 계좌로 보내라는 말을 들었다."],
    ["신용점수 비용", "신용점수 상향을 보장하며 작업비를 받는 절차는 없다.", "작업비를 내면 신용점수를 바로 올려 준다는 안내를 받았다."],
    ["환불 보장", "수수료를 먼저 내면 부결 시 전액 반환한다는 개인 약속을 하지 않는다.", "부결되면 돌려준다며 개인 계좌 수수료를 요구받았다."],
    ["신고 확인", "선납 비용 요구가 있으면 거래를 중단하고 공식 채널과 신고기관에 확인한다.", "선납 비용을 보낸 뒤 문제가 생기면 신고하라는 안내를 받았다."],
  ]],
  ["collection_threat", "가람채권관리", "GR-CT11 연체조정안내", ["risk", "regulation"], true, [
    ["야간 연락", "채무자 동의 없이 오후 9시부터 오전 8시 사이에 추심 연락을 하지 않는다.", "밤 11시에도 연체 추심 전화를 받을 수 있다는 안내를 받았다."],
    ["제삼자 공개", "채무 사실을 가족이나 직장 동료에게 임의로 알리지 않는다.", "연체 사실을 직장에 알리겠다는 말을 들었다."],
    ["법적 조치 고지", "실제로 확정되지 않은 압류나 형사처벌을 즉시 집행할 것처럼 말하지 않는다.", "오늘 갚지 않으면 바로 형사처벌된다는 안내를 받았다."],
    ["상환 협의", "상환 곤란 사유와 소득을 확인한 뒤 가능한 조정 절차를 안내한다.", "상환이 어렵다는 설명을 들어보지 않고 전액만 요구받았다."],
    ["이의 제기", "채무 내용에 이의가 있으면 서면 확인과 공식 이의 제기 채널을 요청할 수 있다.", "채무 내용이 달라도 이의를 제기할 수 없다는 말을 들었다."],
  ]],
  ["credit_line_renewal", "여울은행", "YU-CR12 한도대출", ["product", "freshness"], false, [
    ["갱신 심사", "한도대출 만기 연장은 자동이 아니며 만기 전에 신용과 소득을 다시 심사한다.", "한도대출은 만기마다 재심사를 받는다고 안내받았다."],
    ["감액 가능", "갱신 심사 결과에 따라 한도가 줄거나 연장이 거절될 수 있다.", "갱신 심사에서 한도가 줄 수 있다고 들었다."],
    ["금리 변경", "갱신 시점의 기준금리와 신용 상태에 따라 적용금리가 달라질 수 있다.", "갱신할 때 금리가 달라질 수 있다고 안내받았다."],
    ["만기 안내", "만기 30일 전부터 앱과 전자문서로 갱신 절차를 안내한다.", "만기 30일 전부터 갱신 안내를 받는다고 들었다."],
    ["미갱신 상환", "갱신이 승인되지 않으면 약정 만기일까지 사용 잔액을 상환해야 한다.", "갱신이 안 되면 만기일까지 잔액을 갚아야 한다고 안내받았다."],
  ]],
  ["mortgage_ltv", "다솜은행", "DS-ML13 주택담보대출", ["numeric", "product"], false, [
    ["담보 평가", "대출한도는 매매가만이 아니라 인정된 담보평가액을 기준으로 계산한다.", "주택담보대출 한도가 담보평가액을 기준으로 정해진다고 들었다."],
    ["규제 반영", "담보인정비율은 주택 소재지와 보유 주택 수 등 적용 규제를 반영한다.", "담보인정비율에 지역과 주택 수 규제가 반영된다고 안내받았다."],
    ["선순위 차감", "기존 선순위 채권과 임차보증금은 가용 담보한도에서 차감될 수 있다.", "선순위 채권이 담보대출 가능 한도에서 빠질 수 있다고 들었다."],
    ["최종 한도", "사전 조회 한도는 확정 승인이 아니며 서류 심사 뒤 달라질 수 있다.", "사전 조회 한도는 서류 심사 뒤 바뀔 수 있다고 안내받았다."],
    ["평가 비용", "외부 담보평가가 필요한 경우 비용 부담 주체와 금액을 실행 전에 알린다.", "담보평가 비용은 대출 실행 전에 안내된다고 들었다."],
  ]],
  ["policy_loan_eligibility", "희망서민원", "HM-PL14 정책보증대출", ["eligibility", "freshness"], false, [
    ["소득 요건", "신청일 기준 연소득 4천5백만원 이하인 신청자를 심사 대상으로 한다.", "연소득 4천5백만원 이하가 신청 요건이라고 안내받았다."],
    ["재직 확인", "근로자는 현재 재직과 최근 소득을 공식 서류로 확인한다.", "근로자는 재직과 최근 소득 서류를 내야 한다고 들었다."],
    ["보증 심사", "대출기관 심사와 별도로 보증기관의 보증 심사를 통과해야 한다.", "은행 심사 외에 보증기관 심사도 필요하다고 안내받았다."],
    ["중복 이용", "같은 보증 계정의 이용 잔액은 새 보증 가능 금액에서 차감한다.", "기존 보증 이용 잔액이 새 한도에서 차감된다고 들었다."],
    ["현재 공고", "신청 가능 여부와 세부 요건은 신청일에 유효한 공식 공고를 적용한다.", "정책대출 요건은 신청일의 공식 공고로 확인한다고 안내받았다."],
  ]],
  ["student_repayment", "배움기금", "BU-SR15 학업상환대출", ["numeric", "eligibility"], false, [
    ["상환 개시", "의무상환은 연간 소득이 해당 연도의 상환기준소득을 넘을 때 시작한다.", "소득이 상환기준소득을 넘으면 의무상환이 시작된다고 들었다."],
    ["자발 상환", "의무상환 전에도 수수료 없이 원금 일부나 전부를 자발 상환할 수 있다.", "의무상환 전에도 수수료 없이 미리 갚을 수 있다고 안내받았다."],
    ["소득 확인", "의무상환액은 공식 소득 자료와 적용 연도의 상환율로 계산한다.", "의무상환액이 공식 소득과 해당 연도 상환율로 계산된다고 들었다."],
    ["유예 신청", "실직이나 휴직 사유가 있으면 증빙을 갖춰 상환유예를 신청할 수 있다.", "실직이나 휴직 때 증빙으로 상환유예를 신청할 수 있다고 안내받았다."],
    ["주소 변경", "연락처와 주소가 바뀌면 고지 누락을 막기 위해 공식 채널에서 갱신한다.", "주소가 바뀌면 공식 채널에서 정보를 고쳐야 한다고 들었다."],
  ]],
  ["auto_loan_title", "모아오토금융", "MA-AL16 자동차대출", ["product", "fees"], false, [
    ["소유권", "차량 소유권은 등록 절차가 끝난 뒤 구매자 명의로 등록한다.", "자동차대출 차량은 등록 뒤 구매자 명의가 된다고 안내받았다."],
    ["저당 설정", "대출채권 보전을 위해 차량에 금융회사 저당권을 설정할 수 있다.", "대출 기간에 차량 저당권이 설정될 수 있다고 들었다."],
    ["해지 절차", "대출을 전액 상환하면 확인 뒤 저당권 해지에 필요한 서류를 제공한다.", "전액 상환 뒤 저당권 해지 서류를 받을 수 있다고 안내받았다."],
    ["등록 비용", "취득세와 등록 관련 공과금은 대출이자와 구분해 계약 전에 표시한다.", "차량 등록 공과금은 대출이자와 따로 표시된다고 들었다."],
    ["차량 변경", "승인 뒤 구매 차량이 바뀌면 대출 실행 전에 담보와 한도를 다시 확인한다.", "승인 뒤 차량이 바뀌면 실행 전에 다시 확인한다고 안내받았다."],
  ]],
  ["rent_deposit_guarantee", "포근주거보증", "PG-RD17 임차보증금대출", ["eligibility", "product"], false, [
    ["계약 확인", "확정일자를 갖춘 유효한 임대차계약과 계약금 지급 사실을 확인한다.", "유효한 임대차계약과 계약금 지급 확인이 필요하다고 들었다."],
    ["지급 방식", "대출금은 원칙적으로 확인된 임대인 명의 계좌에 지급한다.", "임차보증금 대출금이 임대인 명의 계좌로 지급된다고 안내받았다."],
    ["보증 요건", "주택과 임대차계약이 보증기관의 대상 요건을 충족해야 한다.", "주택과 계약이 보증기관 요건을 충족해야 한다고 들었다."],
    ["계약 변경", "임대인이나 보증금이 바뀌면 실행 전에 변경 계약을 다시 심사한다.", "임대인이나 보증금이 바뀌면 다시 심사한다고 안내받았다."],
    ["반환 상환", "임대차 종료 때 반환받은 보증금으로 대출 잔액을 우선 상환한다.", "계약 종료 때 돌려받은 보증금으로 대출을 먼저 갚는다고 들었다."],
  ]],
  ["microcredit_rate", "이음소액금융", "IU-MC18 생활안정대출", ["numeric", "fees"], false, [
    ["적용 금리", "약정금리는 연 8.5% 고정이며 연체가 없으면 계약기간 동안 유지한다.", "생활안정대출 금리가 연 8.5% 고정이라고 안내받았다."],
    ["대출 한도", "심사 가능한 대출한도는 1인당 최대 5백만원이다.", "생활안정대출 한도가 최대 5백만원이라고 들었다."],
    ["상환 기간", "상환기간은 12개월 또는 24개월 원리금균등 방식 중 선택한다.", "12개월이나 24개월 원리금균등으로 갚는다고 안내받았다."],
    ["취급 비용", "대출 실행을 위한 별도 전산비와 상담비는 받지 않는다.", "대출 실행 때 전산비나 상담비가 없다고 들었다."],
    ["연체 가산", "연체이자율은 약정금리에 연 3%포인트를 더하되 법정 상한을 넘지 않는다.", "연체 시 약정금리에 3%포인트가 더해진다고 안내받았다."],
  ]],
  ["debt_adjustment_effect", "새출발상담원", "SC-DA19 채무조정연계", ["regulation", "freshness"], false, [
    ["조정 확정", "상담 신청만으로 채무조정이 확정되지 않으며 심사와 동의 절차가 필요하다.", "상담을 신청하면 채무조정이 바로 확정되는 것은 아니라고 들었다."],
    ["추심 중단", "추심 중단 시점은 적용 제도와 공식 접수·통지 상태에 따라 달라진다.", "상담 예약만 하면 모든 추심이 즉시 중단된다는 말을 들었다."],
    ["신용 영향", "채무조정 이용 사실은 적용 규정에 따라 신용정보에 반영될 수 있다.", "채무조정이 신용정보에 반영될 수 있다고 안내받았다."],
    ["상환 계획", "확정된 조정안의 상환금과 기간은 공식 결정문에서 확인한다.", "조정 상환금과 기간은 공식 결정문으로 확인한다고 들었다."],
    ["조건 변경", "소득과 재산이 달라지면 정해진 절차에 따라 조정안 변경을 신청할 수 있다.", "소득이나 재산 변화 때 조정안 변경을 신청할 수 있다고 안내받았다."],
  ]],
  ["broker_disclosure", "바른대출중개", "BR-BD20 등록중개상담", ["mixed_name", "fees"], false, [
    ["등록 확인", "대출중개인은 등록번호와 소속 법인을 공식 조회 경로로 확인할 수 있어야 한다.", "상담사의 등록번호와 소속 법인을 공식 조회할 수 있다고 들었다."],
    ["중개수수료", "대출을 받는 소비자에게 중개수수료나 사례비를 요구하지 않는다.", "대출 소비자는 중개수수료를 내지 않는다고 안내받았다."],
    ["비교 설명", "제안 상품의 금리와 비용 및 주요 불이익을 비교해 설명한다.", "중개 상담에서 금리와 비용의 주요 차이를 설명받는다고 들었다."],
    ["광고 주체", "광고에는 실제 등록된 중개 법인명과 연락처를 명확히 표시한다.", "대출 광고에 등록 법인명과 연락처가 표시된다고 안내받았다."],
    ["계약 강요", "중개인은 특정 상품 계약이나 즉시 송금을 강요하지 않는다.", "중개 상담사가 특정 상품의 즉시 계약을 강요할 수 없다고 들었다."],
  ]],
];

const cases = families.map(([id, institution, product, coverage, riskCritical, facts], index) => {
  const institutionCode = `V6_INST_${String(index + 1).padStart(2, "0")}`;
  const productCode = `V6_PRODUCT_${String(index + 1).padStart(2, "0")}`;
  const authority = riskCritical ? "A" : "B";
  const documents = facts.map(([facet, text], offset) => ({
    key: `u${offset + 1}`, facet, text: `${institution}의 ${product} 공식 안내는 ${text}`,
    source_family: `synthetic-v6-${id}`, evidence_unit: `${id}-${offset + 1}`,
    institution_code: institutionCode, product_code: productCode,
    effective_from: "2026-06-01", effective_to: null, authority_level: authority,
    source_fingerprint: `${id}-${offset + 1}`, channel_type: riskCritical ? "OFFICIAL_WARNING" : "PRODUCT_TERMS",
  }));
  documents.push(
    { key: "u6", facet: "이름이 비슷한 다른 기관", text: `${institution}연합의 ${product} 유사 상품은 별도 조건을 사용한다.`,
      source_family: `synthetic-v6-${id}-similar`, evidence_unit: `${id}-6`, institution_code: `${institutionCode}_SIMILAR`, product_code: productCode,
      effective_from: "2026-06-01", effective_to: null, authority_level: "B", source_fingerprint: `${id}-6`, channel_type: "PRODUCT_TERMS" },
    { key: "u7", facet: "종료된 과거 조건", text: `${institution}의 ${product} 2024년 조건은 현재 적용 문서가 아니다.`,
      source_family: `synthetic-v6-${id}`, evidence_unit: `${id}-7`, institution_code: institutionCode, product_code: productCode,
      effective_from: "2024-01-01", effective_to: "2025-12-31", authority_level: authority, source_fingerprint: `${id}-7`, channel_type: "PRODUCT_TERMS" },
    { key: "u8", facet: "미래 개정 조건", text: `${institution}의 ${product} 2027년 개정안은 아직 효력이 시작되지 않았다.`,
      source_family: `synthetic-v6-${id}`, evidence_unit: `${id}-8`, institution_code: institutionCode, product_code: productCode,
      effective_from: "2027-01-01", effective_to: null, authority_level: authority, source_fingerprint: `${id}-8`, channel_type: "PRODUCT_TERMS" },
    { key: "u9", facet: "같은 기관의 인접 상품", text: `${institution}의 ${product} 플러스 상품은 심사와 비용 조건이 다른 별도 상품이다.`,
      source_family: `synthetic-v6-${id}-adjacent`, evidence_unit: `${id}-9`, institution_code: institutionCode, product_code: `${productCode}_PLUS`,
      effective_from: "2026-06-01", effective_to: null, authority_level: "B", source_fingerprint: `${id}-9`, channel_type: "PRODUCT_TERMS" },
    { key: "u10", facet: "요청 밖 운영 정보", text: `${institution}의 대표 상담 창구는 평일 업무시간에 운영한다.`,
      source_family: `synthetic-v6-${id}-general`, evidence_unit: `${id}-10`, institution_code: institutionCode, product_code: null,
      effective_from: "2026-06-01", effective_to: null, authority_level: "B", source_fingerprint: `${id}-general`, channel_type: "GENERAL_GUIDE" },
    { key: "u11", facet: "비공식 홍보 문구", text: `${product}과 이름이 비슷한 비공식 홍보물의 즉시 승인 문구는 공식 계약 조건이 아니다.`,
      source_family: `synthetic-v6-${id}-promotion`, evidence_unit: `${id}-11`, institution_code: institutionCode, product_code: null,
      effective_from: "2026-06-01", effective_to: null, authority_level: "C", source_fingerprint: `${id}-11`, channel_type: "GENERAL_GUIDE" },
    { key: "u12", facet: "운영 정보 재게시", text: `${institution} 대표 상담 창구의 업무시간 안내를 같은 원문에서 재게시했다.`,
      source_family: `synthetic-v6-${id}-general-repost`, evidence_unit: `${id}-12`, institution_code: institutionCode, product_code: null,
      effective_from: "2026-06-01", effective_to: null, authority_level: "C", source_fingerprint: `${id}-general`, channel_type: "GENERAL_GUIDE" },
  );
  const claims = facts.map(([, , claim], offset) => ({
    key: `c${offset + 1}`, text: `${institution}의 ${product} 상담에서 ${claim}`,
    truth: riskCritical ? "FALSE" : offset === 4 && id === "variable_rate_reset" ? "FALSE" : "TRUE",
    relevant_units: [`u${offset + 1}`], critical_units: riskCritical ? [`u${offset + 1}`] : [],
    hard_negative_units: ["u6", "u7", "u8", "u9", "u10", "u11", "u12"],
    rationale: "현재 기관·상품의 공식 unit 한 건만 정답이다. 유사 기관, 과거·미래판, 인접 상품, 비공식 홍보, 재게시 운영 정보는 hard negative다.",
    target_institution_code: institutionCode, target_product_code: null, as_of_date: "2026-09-08",
  }));
  return { id, split: "gate", coverage, risk_critical: riskCritical, documents, claims };
});

export const fixture = {
  schema_version: 6,
  fixture_set: "finshield-korean-finance-retrieval-fast-v6",
  status: "preregistered-provider-unmeasured",
  scope: "synthetic Korean P0 loan retrieval; not factual financial advice or legal interpretation",
  split_policy: "twenty new scenario families disjoint from v5; author-visible but never sent to Embed or Fast before preregistration merge",
  filter_policy: "institution and as-of date only; product identity remains something to verify",
  query_policy: "one query is one confirmed claim; five claims form one case and final top five must represent all five",
  cases,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = fileURLToPath(new URL("../fixtures/retrieval-fast-v6.json", import.meta.url));
  writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o644 });
  console.log(`wrote ${cases.length} cases, ${cases.flatMap((row) => row.documents).length} documents, ${cases.flatMap((row) => row.claims).length} claims`);
}
