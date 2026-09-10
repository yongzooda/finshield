"""사전 고정 OCR 재평가용 합성 문서 v2. 실제 상품·기관·사용자 정보가 아니다.

v1 과 같은 생성 규칙·판정 산식·합격선을 쓰고 시나리오 가족만 8개를 새로 쓴다.
v1 의 여덟 가족(refinance·living·institution·channel·withdrawal·fee·overdue·
repayment)은 이미 노출된 표본이므로 하나도 재사용하지 않는다. 문서 구조와
label, 표 배치, 150dpi 렌더링, 페이지 수는 v1 그대로 두어 두 측정을 비교할
수 있게 한다.

주소 표기는 RFC 2606 이 예약한 이름만 쓴다. v1 이 쓴 맨 TLD 형태
`https://<slug>.example/loan` 을 네 가족에 그대로 남겨 이미 관측된 어려운
경우를 버리지 않고, 나머지 네 가족은 실제 문서에 더 흔한
`https://www.example.com/<slug>` 형태를 쓴다. 두 형태를 섞은 이유와 비율은
측정 전에 고정하며 결과가 나온 뒤에 바꾸지 않는다.
"""
from pathlib import Path
import hashlib
import json
import sys
import fitz

ROOT = Path(__file__).parent
FONT = sys.argv[1] if len(sys.argv) > 1 else '/System/Library/Fonts/AppleSDGothicNeo.ttc'

# (가족, 기관, 상품, slug, 주소 형태, 부정 표현 1, 부정 표현 2)
# 주소 형태 'tld' 는 v1 과 같은 맨 예약 TLD, 'host' 는 예약 도메인 경로형이다.
FAMILIES = [
 ('collateral','가상한별은행','시험담보론','collateral','tld',
  '담보 없이 한도가 늘어난다고 보장하지 않습니다.','설정 비용을 대신 내주지 않습니다.'),
 ('refund','가상새롬금융','시험환급론','refund','tld',
  '보증금을 먼저 받고 환급하지 않습니다.','환급 심사 기간을 단축해 주지 않습니다.'),
 ('credit','가상도담은행','시험등급론','credit','tld',
  '신용점수를 대신 올려 주지 않습니다.','기존 연체 기록을 삭제하지 않습니다.'),
 ('bridge','가상바로금융','시험연결론','bridge','tld',
  '기존 대출 상환을 대신 처리하지 않습니다.','전환만으로 금리가 낮아지지 않습니다.'),
 ('insurance','가상해든은행','시험보험론','insurance','host',
  '보험료를 개인 계좌로 받지 않습니다.','보험 가입이 승인 조건이 아닙니다.'),
 ('remote','가상늘봄금융','시험간편론','remote','host',
  '원격 제어 앱 설치를 요구하지 않습니다.','휴대전화 인증만으로 실행하지 않습니다.'),
 ('paperwork','가상가온은행','시험서류론','paperwork','host',
  '서류를 대신 작성해 주지 않습니다.','소득 자료 수정 요청에 응하지 않습니다.'),
 ('earlyrepay','가상한울금융','시험중도론','earlyrepay','host',
  '중도상환 수수료가 항상 면제되지 않습니다.','상환 순서를 임의로 바꾸지 않습니다.'),
]


def address(slug, shape):
    return f'https://{slug}.example/loan' if shape == 'tld' else f'https://www.example.com/{slug}'


def document(family_index, page_number, variant):
    family, institution, product, slug, shape, negative1, negative2 = FAMILIES[family_index]
    index = family_index + 1
    rate = f'{index + 2}.{(page_number + variant) % 10}%'
    amount = f'{(index + page_number) * 125:,}만원'
    term = f'{12 + page_number * 3}개월'
    fee = f'{(index + variant) % 3}.{page_number % 10}%'
    url = address(slug, shape)
    lines = ['FinShield 합성 품질 평가 문서', '실제 상품 조건과 사용자 문서가 아닙니다.',
             f'문서 구분: {family}', f'페이지: {page_number}',
             f'기관: {institution}', f'상품: {product}', f'주소: {url}',
             f'연 금리: {rate}', f'한도: {amount}', f'상환 기간: {term}',
             f'보증료율: {fee}', negative1, negative2]
    doc = fitz.open(); page = doc.new_page(width=595, height=842)
    page.insert_font(fontname='ko', fontfile=FONT)
    # 앞부분은 안내문, 조건은 선이 있는 2열 표다. 모든 값은 수동 label로 고정한다.
    for pos, line in enumerate(lines[:7]):
        page.insert_text((38, 52 + pos * 34), line, fontname='ko', fontsize=15)
    y = 302
    for pos, line in enumerate(lines[7:11]):
        label, value = line.split(': ', 1); top = y + pos * 42
        page.draw_rect(fitz.Rect(38, top, 555, top + 42), color=(.4, .4, .4), width=.5)
        page.draw_line((210, top), (210, top + 42), color=(.4, .4, .4), width=.5)
        page.insert_text((48, top + 27), label + ':', fontname='ko', fontsize=15)
        page.insert_text((226, top + 27), value, fontname='ko', fontsize=15)
    for pos, line in enumerate(lines[11:]):
        page.insert_text((38, 515 + pos * 40), line, fontname='ko', fontsize=14)
    return doc, {'text': '\n'.join(lines),
                 'fields': {'institution': institution, 'product': product, 'url': url},
                 'negations': [negative1, negative2]}


fixtures = []
for fi, family_row in enumerate(FAMILIES):
    family = family_row[0]
    for variant, (kind, ext, pages) in enumerate([('text', 'txt', 1), ('image', 'png', 1), ('digital', 'pdf', 2), ('scanned', 'pdf', 10)]):
        name = f'{family}-{kind}.{ext}'; expected = []; out = fitz.open() if kind in ('digital', 'scanned') else None
        for number in range(1, pages + 1):
            page_doc, truth = document(fi, number, variant); expected.append(truth)
            if kind == 'text': (ROOT / name).write_text(truth['text'] + '\n')
            elif kind == 'image': page_doc[0].get_pixmap(dpi=150).save(ROOT / name)
            elif kind == 'digital': out.insert_pdf(page_doc)
            else:
                page = out.new_page(width=595, height=842)
                page.insert_image(page.rect, stream=page_doc[0].get_pixmap(dpi=150).tobytes('png'))
            page_doc.close()
        if out:
            if kind == 'scanned': assert all(not p.get_text().strip() for p in out)
            else: out.subset_fonts()
            out.save(ROOT / name, garbage=4, deflate=True, no_new_id=True); out.close()
        raw = (ROOT / name).read_bytes(); assert len(raw) <= 10 * 1024 * 1024
        fixtures.append({'id': f'{family}-{kind}', 'family': family, 'kind': kind, 'path': name,
                         'url_shape': family_row[4], 'pages': expected, 'bytes': len(raw),
                         'sha256': hashlib.sha256(raw).hexdigest()})
manifest = {'version': 'ocr-quality-v2', 'synthetic_only': True, 'independent_blind_review': False,
            'table_detection': False, 'documents': 32, 'pages': 112,
            'previous_version': 'ocr-quality-v1', 'reused_families': [],
            'url_shapes': {'tld': 4, 'host': 4}, 'fixtures': fixtures}
(ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'documents': len(fixtures), 'pages': sum(len(f['pages']) for f in fixtures),
                  'bytes': sum(f['bytes'] for f in fixtures)}))
