"""합성 개발 진단 Fixture. 실제 상품 조건과 사용자 문서가 아니다."""
import hashlib
import json
from pathlib import Path
import sys
import fitz

font = sys.argv[1] if len(sys.argv) > 1 else '/System/Library/Fonts/AppleSDGothicNeo.ttc'
root = Path(__file__).parent

def page_doc(number):
    rate = f'3.{number % 10}%'
    rows = ['FinShield OCR 합성 시험용', '실제 상품 조건이 아닙니다.',
            f'시험 페이지 {number}', '기관: 서민금융진흥원', '상품: 햇살론15',
            f'연 금리: {rate}', '대출 한도: 3천만원', '선입금 수수료를 요구하지 않습니다.',
            '계약 해지를 보장하지 않습니다.', '공식 상담 번호: 1397',
            '공식 주소: https://www.kinfa.or.kr']
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_font(fontname='ko', fontfile=font)
    for i, line in enumerate(rows):
        page.insert_text((45, 70 + i*38), line, fontname='ko', fontsize=17)
    anchors = ['서민금융진흥원', '햇살론15', rate, '3천만원', '수수료를요구하지않습니다.',
               '해지를보장하지않습니다.', '1397', 'https://www.kinfa.or.kr', f'시험페이지{number}']
    return doc, anchors

native, anchors = page_doc(1)
native.subset_fonts()
native.save(root/'digital.pdf', garbage=4, deflate=True, no_new_id=True)
native[0].get_pixmap(dpi=150).save(root/'image.png')
scan = fitz.open()
expected=[]
for number in range(1, 11):
    doc, fields = page_doc(number)
    page = scan.new_page(width=595,height=842)
    page.insert_image(page.rect, stream=doc[0].get_pixmap(dpi=150).tobytes('png'))
    expected.append(fields)
    doc.close()
assert all(not page.get_text().strip() for page in scan)
scan.save(root/'scanned-10.pdf', garbage=4, deflate=True, no_new_id=True)
fixtures=[]
for name, fmt, pages in [('digital.pdf','pdf',[anchors]), ('image.png','png',[anchors]), ('scanned-10.pdf','pdf',expected)]:
    data=(root/name).read_bytes()
    fixtures.append(dict(id=name.split('.')[0],path=name,format=fmt,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),pages=pages))
(root/'manifest.json').write_text(json.dumps(dict(version='ocr-development-v1',synthetic_only=True,gate_evidence=False,fixtures=fixtures),ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{key: f[key] for key in ['id','bytes','sha256']} for f in fixtures], indent=2))
